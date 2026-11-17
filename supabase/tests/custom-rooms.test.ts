import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  all,
  asClient,
  beginSubmission,
  completeSubmission,
  createDb,
  createUser,
  endOvertime,
  expectDbError,
  makeBattle,
  one,
  rating,
  resetState,
  skipCooldown,
} from "./helpers.ts";

/**
 * A Submit that passes every hidden test (however many the problem has), after
 * which the other player gives up their overtime: the battle is then over.
 */
async function solve(db: PGlite, user: string, battle: string) {
  await skipCooldown(db);
  const begun = await beginSubmission(db, user, battle);
  const result = await completeSubmission(db, begun.submission_id, "accepted", begun.total);
  await endOvertime(db, battle);
  return result;
}

interface RoomPlayer {
  user_id: string;
  username: string;
  avatar: string;
  rating: number;
}
interface Room {
  id: string;
  code: string;
  status: "open" | "started" | "closed" | "expired";
  difficulty: string;
  duration_minutes: number;
  expires_at: string;
  battle_id: string | null;
  is_host: boolean;
  host: RoomPlayer;
  guest: RoomPlayer | null;
}

const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/;

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());

let host: string;
let guest: string;
let other: string;
beforeEach(async () => {
  await resetState(db);
  host = await createUser(db, "host_player", 1250);
  guest = await createUser(db, "guest_player", 1180);
  other = await createUser(db, "someone_else");
});

const call = async <T = Room>(sql: string, params: unknown[]) =>
  (await one<{ r: T }>(db, `select ${sql} as r`, params)).r;
const createRoom = (user: string, difficulty = "any", minutes = 15) =>
  call("public.create_room($1, $2, $3)", [user, difficulty, minutes]);
const joinRoom = (user: string, code: string) => call("public.join_room($1, $2)", [user, code]);
const preview = (user: string, code: string) =>
  call("public.get_room_by_code($1, $2)", [user, code]);
const startRoom = (user: string, room: string) => call("public.start_room($1, $2)", [user, room]);
const leaveRoom = (user: string, room: string) =>
  call<{ ok: boolean }>("public.leave_room($1, $2)", [user, room]);
const currentRoom = (user: string) => call<Room | null>("public.get_current_room($1)", [user]);
const getRoom = (user: string, room: string) => call("public.get_room($1, $2)", [user, room]);
const rematch = (user: string, battle: string) =>
  call("public.rematch_room($1, $2)", [user, battle]);
const expire = (room: string) =>
  db.query(
    "update public.custom_rooms set expires_at = now() - interval '1 second' where id = $1",
    [room],
  );

async function startedBattle(): Promise<{ room: Room; battle: string }> {
  const room = await createRoom(host, "easy", 10);
  await joinRoom(guest, room.code);
  const started = await startRoom(host, room.id);
  // Skip the get-ready countdown.
  await db.query(
    "update public.battles set starts_at = now() - interval '1 second' where id = $1",
    [started.battle_id],
  );
  return { room: started, battle: started.battle_id! };
}

describe("creating a room", () => {
  it("gives the host a 6-character code with no look-alike characters", async () => {
    const room = await createRoom(host);
    expect(room.code).toMatch(CODE);
    expect(room).toMatchObject({
      status: "open",
      difficulty: "any",
      duration_minutes: 15,
      is_host: true,
      guest: null,
      battle_id: null,
    });
    expect(room.host).toMatchObject({ user_id: host, username: "host_player", rating: 1250 });
    const minutes = (Date.parse(room.expires_at) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  it("makes different codes for different rooms", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const user = await createUser(db, `maker_${i}`);
      codes.add((await createRoom(user)).code);
    }
    expect(codes.size).toBe(12);
  });

  it("accepts only the offered settings", async () => {
    await expectDbError(createRoom(host, "extreme"), "INVALID_INPUT");
    await expectDbError(createRoom(host, "easy", 20), "INVALID_INPUT");
    await expectDbError(createRoom(host, "easy", 0), "INVALID_INPUT");
    const room = await createRoom(host, "hard", 30);
    expect(room).toMatchObject({ difficulty: "hard", duration_minutes: 30 });
  });

  it("keeps one open room per player: a new room closes the old one", async () => {
    const first = await createRoom(host);
    const second = await createRoom(host);
    expect(second.id).not.toBe(first.id);
    const statuses = await all<{ id: string; status: string }>(
      db,
      "select id, status from public.custom_rooms where host_id = $1",
      [host],
    );
    expect(statuses).toEqual(
      expect.arrayContaining([
        { id: first.id, status: "closed" },
        { id: second.id, status: "open" },
      ]),
    );
    expect((await currentRoom(host))?.id).toBe(second.id);
  });

  it("is refused while the player is in a battle", async () => {
    await makeBattle(db, host, other);
    await expectDbError(createRoom(host), "ALREADY_IN_BATTLE");
  });

  it("takes the player out of the ranked queue", async () => {
    await db.query("select public.find_match($1)", [host]);
    await createRoom(host);
    const queued = await all(db, "select 1 from public.matchmaking_queue where user_id = $1", [
      host,
    ]);
    expect(queued).toHaveLength(0);
  });
});

describe("looking up and joining by code", () => {
  it("shows who hosts and the settings, whatever the case or spacing typed", async () => {
    const room = await createRoom(host, "medium", 10);
    const seen = await preview(guest, `  ${room.code.toLowerCase()} `);
    expect(seen).toMatchObject({
      id: room.id,
      is_host: false,
      difficulty: "medium",
      duration_minutes: 10,
      guest: null,
    });
    expect(seen.host.username).toBe("host_player");
  });

  it("explains unknown, malformed and expired codes", async () => {
    await expectDbError(preview(guest, "ABCDEF"), "ROOM_NOT_FOUND");
    await expectDbError(preview(guest, "ABC"), "INVALID_INPUT");
    await expectDbError(preview(guest, "ABCD0O"), "INVALID_INPUT");
    const room = await createRoom(host);
    await expire(room.id);
    await expectDbError(preview(guest, room.code), "ROOM_EXPIRED");
    await expectDbError(joinRoom(guest, room.code), "ROOM_EXPIRED");
  });

  it("puts the friend in as the guest", async () => {
    const room = await createRoom(host);
    const joined = await joinRoom(guest, room.code);
    expect(joined).toMatchObject({ id: room.id, is_host: false, status: "open" });
    expect(joined.guest).toMatchObject({ user_id: guest, username: "guest_player" });
    expect((await getRoom(host, room.id)).guest?.user_id).toBe(guest);
    // Joining again is harmless.
    expect((await joinRoom(guest, room.code)).guest?.user_id).toBe(guest);
  });

  it("refuses your own room and a full room", async () => {
    const room = await createRoom(host);
    await expectDbError(joinRoom(host, room.code), "ROOM_OWN");
    await joinRoom(guest, room.code);
    await expectDbError(joinRoom(other, room.code), "ROOM_FULL");
    await expectDbError(preview(other, room.code), "ROOM_FULL");
  });

  it("closes the guest's own open room when they join someone else's", async () => {
    const theirs = await createRoom(guest);
    const room = await createRoom(host);
    await joinRoom(guest, room.code);
    const status = await one<{ status: string }>(
      db,
      "select status from public.custom_rooms where id = $1",
      [theirs.id],
    );
    expect(status.status).toBe("closed");
    expect((await currentRoom(guest))?.id).toBe(room.id);
  });

  it("is refused while the friend is in a battle", async () => {
    const room = await createRoom(host);
    await makeBattle(db, guest, other);
    await expectDbError(joinRoom(guest, room.code), "ALREADY_IN_BATTLE");
  });

  it("hides started rooms from everyone but their players", async () => {
    const { room } = await startedBattle();
    await expectDbError(preview(other, room.code), "ROOM_NOT_FOUND");
    expect((await preview(guest, room.code)).status).toBe("started");
  });
});

describe("leaving", () => {
  it("lets the guest leave and the host wait for someone else", async () => {
    const room = await createRoom(host);
    await joinRoom(guest, room.code);
    await leaveRoom(guest, room.id);
    expect((await getRoom(host, room.id)).guest).toBeNull();
    expect((await joinRoom(other, room.code)).guest?.user_id).toBe(other);
  });

  it("closes the room when the host leaves", async () => {
    const room = await createRoom(host);
    await joinRoom(guest, room.code);
    await leaveRoom(host, room.id);
    expect((await getRoom(guest, room.id)).status).toBe("closed");
    expect(await currentRoom(guest)).toBeNull();
    await expectDbError(joinRoom(other, room.code), "ROOM_NOT_FOUND");
  });

  it("is only for the room's players", async () => {
    const room = await createRoom(host);
    await expectDbError(leaveRoom(other, room.id), "NOT_PARTICIPANT");
    await expectDbError(getRoom(other, room.id), "NOT_PARTICIPANT");
  });
});

describe("starting", () => {
  it("only the host can start, and only with a guest", async () => {
    const room = await createRoom(host);
    await expectDbError(startRoom(host, room.id), "ROOM_NOT_READY");
    await joinRoom(guest, room.code);
    await expectDbError(startRoom(guest, room.id), "NOT_HOST");
    await expectDbError(startRoom(other, room.id), "NOT_PARTICIPANT");
  });

  it("creates an unrated battle with the room's difficulty and time limit", async () => {
    const room = await createRoom(host, "medium", 30);
    await joinRoom(guest, room.code);
    const started = await startRoom(host, room.id);
    expect(started.status).toBe("started");
    expect(started.battle_id).toBeTruthy();

    const battle = await one<{
      is_rated: boolean;
      minutes: number;
      ready_seconds: number;
      difficulty: string;
    }>(
      db,
      `select b.is_rated,
              extract(epoch from (b.ends_at - b.starts_at)) / 60 as minutes,
              round(extract(epoch from (b.starts_at - now()))) as ready_seconds,
              p.difficulty
       from public.battles b join public.problems p on p.id = b.problem_id
       where b.id = $1`,
      [started.battle_id],
    );
    expect(battle).toMatchObject({ is_rated: false, difficulty: "medium" });
    expect(Number(battle.minutes)).toBe(30);
    expect(Number(battle.ready_seconds)).toBeGreaterThanOrEqual(9);

    const players = await all<{ user_id: string; rating_before: number; is_active: boolean }>(
      db,
      "select user_id, rating_before, is_active from public.battle_players where battle_id = $1 order by rating_before desc",
      [started.battle_id],
    );
    expect(players).toEqual([
      { user_id: host, rating_before: 1250, is_active: true },
      { user_id: guest, rating_before: 1180, is_active: true },
    ]);
    // Both players now see the same battle; starting twice changes nothing.
    expect((await getRoom(guest, room.id)).battle_id).toBe(started.battle_id);
    expect((await startRoom(host, room.id)).battle_id).toBe(started.battle_id);
    expect(await currentRoom(host)).toBeNull();
  });

  it("cannot start an expired room", async () => {
    const room = await createRoom(host);
    await joinRoom(guest, room.code);
    await expire(room.id);
    await expectDbError(startRoom(host, room.id), "ROOM_EXPIRED");
  });

  it("the battle state says it is a custom match", async () => {
    const { room, battle } = await startedBattle();
    const state = await call<{ battle: { is_rated: boolean; room_code: string } }>(
      "public.get_battle_state($1, $2)",
      [guest, battle],
    );
    expect(state.battle).toMatchObject({ is_rated: false, room_code: room.code });
  });
});

describe("results of a custom match", () => {
  it("records who won but leaves ratings and records unchanged", async () => {
    const { battle } = await startedBattle();
    const before = await all(
      db,
      "select id, rating, wins, losses, draws from public.profiles order by id",
    );
    expect((await solve(db, guest, battle)).battle_finished).toBe(true);

    expect(
      await all(db, "select id, rating, wins, losses, draws from public.profiles order by id"),
    ).toEqual(before);
    const players = await all<{ user_id: string; result: string; delta: number }>(
      db,
      `select user_id, result, rating_after - rating_before as delta
       from public.battle_players where battle_id = $1 order by result desc`,
      [battle],
    );
    expect(players).toEqual([
      { user_id: guest, result: "win", delta: 0 },
      { user_id: host, result: "loss", delta: 0 },
    ]);
  });

  it("stays out of rating history and public profile statistics", async () => {
    const { battle } = await startedBattle();
    await solve(db, host, battle);
    const history = await all(db, "select * from public.rating_history where battle_id = $1", [
      battle,
    ]);
    expect(history).toHaveLength(0);

    const profile = await call<{
      recent_battles: unknown[];
      rating_history: number[];
      streak: unknown;
      languages: Record<string, number>;
      wins_by_difficulty: Record<string, number>;
    }>("public.get_public_profile($1)", ["host_player"]);
    expect(profile.recent_battles).toEqual([]);
    expect(profile.rating_history).toEqual([]);
    expect(profile.streak).toBeNull();
    expect(profile.languages).toEqual({});
    expect(profile.wins_by_difficulty).toEqual({ easy: 0, medium: 0, hard: 0 });
  });

  it("ranked battles still change ratings as before", async () => {
    const battle = await makeBattle(db, host, guest);
    await solve(db, guest, battle);
    expect(await rating(db, guest)).toBeGreaterThan(1180);
    expect(await rating(db, host)).toBeLessThan(1250);
  });
});

describe("rematch", () => {
  async function finishedBattle() {
    const { battle } = await startedBattle();
    await solve(db, guest, battle);
    return battle;
  }

  it("opens a new room with the same settings and the friend already in", async () => {
    const battle = await finishedBattle();
    const room = await rematch(guest, battle);
    expect(room).toMatchObject({
      status: "open",
      is_host: true,
      difficulty: "easy",
      duration_minutes: 10,
    });
    expect(room.guest?.user_id).toBe(host);
    expect((await currentRoom(host))?.id).toBe(room.id);
  });

  it("gives both players the same room when both press Rematch", async () => {
    const battle = await finishedBattle();
    const first = await rematch(guest, battle);
    const second = await rematch(host, battle);
    expect(second.id).toBe(first.id);
    expect(second.is_host).toBe(false);
  });

  it("leaves the friend out if they are busy", async () => {
    const battle = await finishedBattle();
    await createRoom(host);
    const room = await rematch(guest, battle);
    expect(room.guest).toBeNull();
  });

  it("is only for finished custom battles and their players", async () => {
    const ranked = await makeBattle(db, host, guest);
    await solve(db, host, ranked);
    await expectDbError(rematch(host, ranked), "INVALID_INPUT");
    const battle = await finishedBattle();
    await expectDbError(rematch(other, battle), "NOT_PARTICIPANT");
  });
});

describe("recent rooms", () => {
  it("lists your last 3 played rooms with the opponent and settings", async () => {
    const recent = async (user: string) =>
      (
        await one<{
          r: {
            opponent: { username: string };
            difficulty: string;
            duration_minutes: number;
          }[];
        }>(db, "select public.get_recent_rooms($1) as r", [user])
      ).r;
    expect(await recent(host)).toEqual([]);

    await startedBattle(); // easy, 10 min, with guest_player
    // An open room nobody joined does not count.
    await createRoom(other, "hard", 30);
    expect(await recent(host)).toEqual([
      {
        opponent: expect.objectContaining({ username: "guest_player" }),
        difficulty: "easy",
        duration_minutes: 10,
        played_at: expect.any(String),
      },
    ]);
    expect((await recent(guest))[0]!.opponent.username).toBe("host_player");
    expect(await recent(other)).toEqual([]);
  });
});

describe("expiry and access", () => {
  it("expires open rooms after 30 minutes, also from the scheduled sweep", async () => {
    const room = await createRoom(host);
    await expire(room.id);
    await db.query("select public.sweep_stale()");
    const row = await one<{ status: string }>(
      db,
      "select status from public.custom_rooms where id = $1",
      [room.id],
    );
    expect(row.status).toBe("expired");
    expect(await currentRoom(host)).toBeNull();
  });

  it("lets only the host and guest read the room row", async () => {
    const room = await createRoom(host);
    await joinRoom(guest, room.code);
    const read = (user: string | null) =>
      asClient(db, user, () => all(db, "select id from public.custom_rooms"));
    expect(await read(host)).toHaveLength(1);
    expect(await read(guest)).toHaveLength(1);
    expect(await read(other)).toHaveLength(0);
    await expect(read(null)).rejects.toThrow(/permission denied/);
  });

  it("keeps the room functions away from browsers", async () => {
    for (const user of [host, null]) {
      await expect(
        asClient(db, user, () => db.query("select public.create_room($1, 'any', 15)", [host])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asClient(db, user, () => db.query("select public.join_room($1, 'ABCDEF')", [host])),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
