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
  findMatch,
  makeBattle,
  one,
  resetState,
} from "./helpers.ts";

interface Player {
  user_id: string;
  username: string;
  avatar: string;
  rating: number;
}
interface Friend extends Player {
  in_battle: boolean;
  head_to_head: { wins: number; losses: number; draws: number };
}
interface Challenge {
  id: string;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  cancel_reason: string | null;
  difficulty: string;
  duration_minutes: number;
  expires_at: string;
  battle_id: string | null;
  is_challenger: boolean;
  challenger: Player;
  challenged: Player;
}

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());

let ana: string;
let ben: string;
let cat: string;
beforeEach(async () => {
  await resetState(db);
  ana = await createUser(db, "ana");
  ben = await createUser(db, "ben");
  cat = await createUser(db, "cat");
});

const call = async <T>(sql: string, params: unknown[]) =>
  (await one<{ r: T }>(db, `select ${sql} as r`, params)).r;
const request = (user: string, username: string) =>
  call<{ status: string; user_id: string }>("public.send_friend_request($1, $2)", [user, username]);
const respond = (user: string, requester: string, accept: boolean) =>
  call<{ status: string }>("public.respond_friend_request($1, $2, $3)", [user, requester, accept]);
const remove = (user: string, other: string) => call("public.remove_friend($1, $2)", [user, other]);
const friends = (user: string) =>
  call<{ friends: Friend[]; incoming: Player[]; outgoing: Player[] }>("public.get_friends($1)", [
    user,
  ]);
const status = (user: string, username: string) =>
  call<{ status: string; in_battle: boolean; head_to_head: Friend["head_to_head"] }>(
    "public.get_friend_status($1, $2)",
    [user, username],
  );
const challenge = (user: string, friend: string, difficulty = "any", minutes = 15) =>
  call<Challenge>("public.send_challenge($1, $2, $3, $4)", [user, friend, difficulty, minutes]);
const answer = (user: string, id: string, accept: boolean) =>
  call<Challenge>("public.respond_challenge($1, $2, $3)", [user, id, accept]);
const notifications = (user: string) =>
  call<{
    friend_requests: number;
    incoming_challenges: Challenge[];
    outgoing_challenge: Challenge | null;
  }>("public.get_notifications($1)", [user]);
async function befriend(a: string, b: string, bName: string) {
  await request(a, bName);
  await respond(b, a, true);
}

describe("friend requests", () => {
  it("need the other player to accept", async () => {
    expect(await request(ana, "BEN")).toEqual({ status: "outgoing", user_id: ben });
    expect((await friends(ana)).outgoing.map((p) => p.username)).toEqual(["ben"]);
    expect((await friends(ben)).incoming.map((p) => p.username)).toEqual(["ana"]);
    expect((await notifications(ben)).friend_requests).toBe(1);
    expect((await status(ben, "ana")).status).toBe("incoming");
    expect((await status(ana, "ben")).status).toBe("outgoing");

    await respond(ben, ana, true);
    expect((await friends(ana)).friends.map((f) => f.username)).toEqual(["ben"]);
    expect((await friends(ben)).friends.map((f) => f.username)).toEqual(["ana"]);
    expect((await status(ana, "ben")).status).toBe("friends");
    expect((await notifications(ben)).friend_requests).toBe(0);
  });

  it("explains impossible requests", async () => {
    await expectDbError(request(ana, "nobody_here"), "PLAYER_NOT_FOUND");
    await expectDbError(request(ana, "ana"), "FRIEND_SELF");
    await befriend(ana, ben, "ben");
    await expectDbError(request(ana, "ben"), "ALREADY_FRIENDS");
    await expectDbError(request(ben, "ana"), "ALREADY_FRIENDS");
  });

  it("asking back accepts a request you already received", async () => {
    await request(ana, "ben");
    expect((await request(ben, "ana")).status).toBe("friends");
    expect((await status(ana, "ben")).status).toBe("friends");
  });

  it("a declined request cannot be sent again for 24 hours", async () => {
    await request(ana, "ben");
    await respond(ben, ana, false);
    expect((await status(ana, "ben")).status).toBe("none");
    await expectDbError(request(ana, "ben"), "REQUEST_DECLINED");
    // The one who declined can still change their mind.
    expect((await request(ben, "ana")).status).toBe("outgoing");
  });

  it("can be sent again after 24 hours", async () => {
    await request(ana, "ben");
    await respond(ben, ana, false);
    await db.query("update public.friendships set responded_at = now() - interval '25 hours'");
    expect((await request(ana, "ben")).status).toBe("outgoing");
  });

  it("limits unanswered requests to 20", async () => {
    for (let i = 0; i < 20; i++) {
      await createUser(db, `target_${i}`);
      await request(ana, `target_${i}`);
    }
    await expectDbError(request(ana, "cat"), "TOO_MANY_REQUESTS");
  });

  it("can be withdrawn, and friends can be removed", async () => {
    await request(ana, "ben");
    await remove(ana, ben);
    expect((await friends(ben)).incoming).toEqual([]);
    await befriend(ana, cat, "cat");
    await remove(cat, ana);
    expect((await friends(ana)).friends).toEqual([]);
  });

  it("only the receiver can answer, and only once", async () => {
    await request(ana, "ben");
    await expectDbError(respond(cat, ana, true), "REQUEST_NOT_FOUND");
    await respond(ben, ana, true);
    await expectDbError(respond(ben, ana, true), "REQUEST_NOT_FOUND");
  });
});

describe("the friends list", () => {
  it("shows who is in a battle and the head-to-head record", async () => {
    await befriend(ana, ben, "ben");
    // ana beats ben once (ben gives up his overtime), then they play again.
    const first = await makeBattle(db, ana, ben);
    const begun = await beginSubmission(db, ana, first);
    await completeSubmission(db, begun.submission_id, "accepted", begun.total);
    await endOvertime(db, first);
    await makeBattle(db, ana, ben);

    const [benSeenByAna] = (await friends(ana)).friends;
    expect(benSeenByAna).toMatchObject({
      username: "ben",
      in_battle: true,
      head_to_head: { wins: 1, losses: 0, draws: 0 },
    });
    expect((await status(ben, "ana")).head_to_head).toEqual({ wins: 0, losses: 1, draws: 0 });
  });
});

describe("challenges", () => {
  beforeEach(async () => {
    await befriend(ana, ben, "ben");
  });

  it("are for friends only", async () => {
    await expectDbError(challenge(ana, cat), "NOT_FRIENDS");
    await expectDbError(challenge(ana, ana), "FRIEND_SELF");
    await expectDbError(challenge(ana, ben, "insane"), "INVALID_INPUT");
  });

  it("wait 30 seconds for an answer and show up for the friend", async () => {
    const sent = await challenge(ana, ben, "hard", 10);
    expect(sent).toMatchObject({
      status: "pending",
      is_challenger: true,
      difficulty: "hard",
      duration_minutes: 10,
      challenged: { username: "ben" },
    });
    const seconds = (Date.parse(sent.expires_at) - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(28);
    expect(seconds).toBeLessThanOrEqual(30);
    const forBen = await notifications(ben);
    expect(forBen.incoming_challenges).toHaveLength(1);
    expect(forBen.incoming_challenges[0]).toMatchObject({ id: sent.id, is_challenger: false });
    expect((await notifications(ana)).outgoing_challenge?.id).toBe(sent.id);
  });

  it("start an unrated battle at once when accepted", async () => {
    const sent = await challenge(ana, ben, "easy", 10);
    const accepted = await answer(ben, sent.id, true);
    expect(accepted.status).toBe("accepted");
    const battle = await one<{ is_rated: boolean; minutes: number; difficulty: string }>(
      db,
      `select b.is_rated, extract(epoch from (b.ends_at - b.starts_at)) / 60 as minutes, p.difficulty
       from public.battles b join public.problems p on p.id = b.problem_id where b.id = $1`,
      [accepted.battle_id],
    );
    expect(battle).toMatchObject({ is_rated: false, difficulty: "easy" });
    expect(Number(battle.minutes)).toBe(10);
    // The challenger learns the battle id from their own notifications.
    expect((await notifications(ana)).outgoing_challenge).toMatchObject({
      status: "accepted",
      battle_id: accepted.battle_id,
    });
    const active = await all(
      db,
      "select user_id from public.battle_players where battle_id = $1 and is_active",
      [accepted.battle_id],
    );
    expect(active).toHaveLength(2);
  });

  it("can be declined, withdrawn, or expire", async () => {
    const first = await challenge(ana, ben);
    expect((await answer(ben, first.id, false)).status).toBe("declined");
    expect((await notifications(ana)).outgoing_challenge?.status).toBe("declined");

    const second = await challenge(ana, ben);
    const withdrawn = await call<Challenge>("public.cancel_challenge($1, $2)", [ana, second.id]);
    expect(withdrawn).toMatchObject({ status: "cancelled", cancel_reason: "withdrawn" });
    await expectDbError(answer(ben, second.id, true), "CHALLENGE_GONE");

    const third = await challenge(ana, ben);
    await db.query(
      "update public.challenges set expires_at = now() - interval '1 second' where id = $1",
      [third.id],
    );
    await expectDbError(answer(ben, third.id, true), "CHALLENGE_EXPIRED");
    expect((await notifications(ben)).incoming_challenges).toEqual([]);
  });

  it("a new challenge replaces your previous unanswered one", async () => {
    await befriend(ana, cat, "cat");
    const first = await challenge(ana, ben);
    await challenge(ana, cat);
    const old = await one<{ status: string; cancel_reason: string }>(
      db,
      "select status, cancel_reason from public.challenges where id = $1",
      [first.id],
    );
    expect(old).toEqual({ status: "cancelled", cancel_reason: "withdrawn" });
  });

  it("challenging each other at the same moment starts the battle", async () => {
    await challenge(ana, ben);
    const crossed = await challenge(ben, ana);
    expect(crossed.status).toBe("accepted");
    expect(crossed.battle_id).toBeTruthy();
  });

  it("only the challenged player can answer", async () => {
    const sent = await challenge(ana, ben);
    await expectDbError(answer(ana, sent.id, true), "NOT_PARTICIPANT");
    await expectDbError(answer(cat, sent.id, true), "NOT_PARTICIPANT");
  });
});

describe("busy players", () => {
  beforeEach(async () => {
    await befriend(ana, ben, "ben");
    await befriend(ana, cat, "cat");
  });

  it("a friend in a battle cannot be challenged", async () => {
    await makeBattle(db, ben, cat);
    await expectDbError(challenge(ana, ben), "FRIEND_BUSY");
    expect((await status(ana, "ben")).in_battle).toBe(true);
  });

  it("you cannot challenge from inside a battle", async () => {
    await makeBattle(db, ana, cat);
    await expectDbError(challenge(ana, ben), "ALREADY_IN_BATTLE");
  });

  it("a winner waiting on the other player's overtime is free again", async () => {
    const battle = await makeBattle(db, ben, cat);
    const begun = await beginSubmission(db, ben, battle);
    await completeSubmission(db, begun.submission_id, "accepted", begun.total);
    // ben won and is free; cat is still coding in overtime.
    expect((await challenge(ana, ben)).status).toBe("pending");
    await expectDbError(challenge(ana, cat), "FRIEND_BUSY");
  });

  it("starting another battle cancels pending challenges, either side", async () => {
    const toBen = await challenge(ana, ben);
    // ben gets a ranked match before answering.
    await findMatch(db, ben);
    const other = await createUser(db, "stranger");
    await findMatch(db, other);
    const row = await one<{ status: string; cancel_reason: string }>(
      db,
      "select status, cancel_reason from public.challenges where id = $1",
      [toBen.id],
    );
    expect(row).toEqual({ status: "cancelled", cancel_reason: "challenged_busy" });
    await expectDbError(answer(ben, toBen.id, true), "CHALLENGE_GONE");
  });

  it("accepting while the challenger got busy explains why", async () => {
    const sent = await challenge(ana, cat);
    // Simulate the challenger entering a battle without the trigger noticing
    // (for example the race between two transactions).
    await db.query(
      "alter table public.battle_players disable trigger battle_players_cancel_challenges",
    );
    await makeBattle(db, ana, ben);
    await db.query(
      "alter table public.battle_players enable trigger battle_players_cancel_challenges",
    );
    expect(await answer(cat, sent.id, true)).toMatchObject({
      status: "cancelled",
      cancel_reason: "challenger_busy",
      battle_id: null,
    });
    const row = await one<{ status: string }>(
      db,
      "select status from public.challenges where id = $1",
      [sent.id],
    );
    expect(row.status).toBe("cancelled");
  });

  it("accepting takes both players out of the ranked queue and their open rooms", async () => {
    await db.query("select public.find_match($1)", [ana]);
    await db.query("select public.create_room($1, 'any', 15)", [ben]);
    const sent = await challenge(ana, ben);
    await answer(ben, sent.id, true);
    const queued = await all(db, "select 1 from public.matchmaking_queue");
    expect(queued).toHaveLength(0);
    const rooms = await all<{ status: string }>(db, "select status from public.custom_rooms");
    expect(rooms).toEqual([{ status: "closed" }]);
  });

  it("removing a friend ends pending challenges between you", async () => {
    const sent = await challenge(ana, ben);
    await remove(ben, ana);
    await expectDbError(answer(ben, sent.id, true), "CHALLENGE_GONE");
  });
});

describe("privacy", () => {
  it("lets only the two players read a request or a challenge", async () => {
    await befriend(ana, ben, "ben");
    await challenge(ana, ben);
    const read = (user: string, table: string) =>
      asClient(db, user, () => all(db, `select id from public.${table}`));
    expect(await read(ana, "friendships")).toHaveLength(1);
    expect(await read(ben, "challenges")).toHaveLength(1);
    expect(await read(cat, "friendships")).toHaveLength(0);
    expect(await read(cat, "challenges")).toHaveLength(0);
    await expect(
      asClient(db, null, () => all(db, "select id from public.friendships")),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps the functions away from browsers", async () => {
    await expect(
      asClient(db, ana, () => db.query("select public.send_friend_request($1, 'ben')", [ana])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asClient(db, ana, () => db.query("select public.get_friends($1)", [ana])),
    ).rejects.toThrow(/permission denied/);
  });
});
