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
  resetState,
} from "./helpers.ts";

interface Rematch {
  status: "none" | "pending" | "accepted" | "declined" | "expired" | "cancelled";
  requested_by_you: boolean | null;
  cancel_reason: string | null;
  new_battle_id: string | null;
  window_ends_at: string;
  rated: boolean;
  series: { you: number; them: number; draws: number };
}

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());

let ana: string;
let ben: string;
let battle: string;
beforeEach(async () => {
  await resetState(db);
  ana = await createUser(db, "ana");
  ben = await createUser(db, "ben");
  battle = await finishedBattle(ana, ben);
});

/** A finished battle that `winner` won (the other player gave up the overtime). */
async function finishedBattle(winner: string, loser: string): Promise<string> {
  const id = await makeBattle(db, winner, loser);
  const begun = await beginSubmission(db, winner, id);
  await completeSubmission(db, begun.submission_id, "accepted", begun.total);
  await endOvertime(db, id);
  return id;
}

const call = async <T = Rematch>(sql: string, params: unknown[]) =>
  (await one<{ r: T }>(db, `select ${sql} as r`, params)).r;
const ask = (user: string, id = battle) => call("public.request_rematch($1, $2)", [user, id]);
const answer = (user: string, accept: boolean, id = battle) =>
  call("public.respond_rematch($1, $2, $3)", [user, id, accept]);
const get = (user: string, id = battle) => call("public.get_rematch($1, $2)", [user, id]);
const cancel = (user: string, id = battle) => call("public.cancel_rematch($1, $2)", [user, id]);
const newBattle = (id: string) =>
  one<{
    is_rated: boolean;
    rematch_of: string;
    minutes: number;
    difficulty: string;
    problem_id: string;
  }>(
    db,
    `select b.is_rated, b.rematch_of, extract(epoch from (b.ends_at - b.starts_at)) / 60 as minutes,
            p.difficulty, b.problem_id
     from public.battles b join public.problems p on p.id = b.problem_id where b.id = $1`,
    [id],
  );

describe("asking for a rematch", () => {
  it("waits for the other player; it starts only when both want it", async () => {
    expect(await get(ana)).toMatchObject({ status: "none", rated: true });
    expect(await ask(ana)).toMatchObject({ status: "pending", requested_by_you: true });
    expect(await get(ben)).toMatchObject({ status: "pending", requested_by_you: false });

    const yes = await answer(ben, true);
    expect(yes.status).toBe("accepted");
    expect((await get(ana)).new_battle_id).toBe(yes.new_battle_id);
    const players = await all(
      db,
      "select user_id from public.battle_players where battle_id = $1 and is_active",
      [yes.new_battle_id],
    );
    expect(players).toHaveLength(2);
  });

  it("pressing Rematch after the other player did is a yes", async () => {
    await ask(ana);
    expect((await ask(ben)).status).toBe("accepted");
  });

  it("is the same kind of battle: same difficulty and time, a new problem", async () => {
    await ask(ana);
    const yes = await answer(ben, true);
    const before = await newBattle(battle);
    const after = await newBattle(yes.new_battle_id!);
    expect(after).toMatchObject({
      is_rated: true,
      rematch_of: battle,
      difficulty: before.difficulty,
    });
    expect(Number(after.minutes)).toBe(Number(before.minutes));
    expect(after.problem_id).not.toBe(before.problem_id);
  });

  it("keeps custom battles unrated", async () => {
    await db.query("update public.battles set is_rated = false where id = $1", [battle]);
    expect((await get(ana)).rated).toBe(false);
    await ask(ana);
    expect((await newBattle((await answer(ben, true)).new_battle_id!)).is_rated).toBe(false);
  });

  it("counts for rating at most twice in 24 hours between the same two players", async () => {
    let current = battle;
    const rated: boolean[] = [];
    for (let game = 0; game < 3; game++) {
      await ask(ana, current);
      const next = (await answer(ben, true, current)).new_battle_id!;
      rated.push((await newBattle(next)).is_rated);
      await db.query(
        "update public.battles set starts_at = now() - interval '1 second' where id = $1",
        [next],
      );
      const begun = await beginSubmission(db, ana, next);
      await completeSubmission(db, begun.submission_id, "accepted", begun.total);
      await endOvertime(db, next);
      current = next;
    }
    expect(rated).toEqual([true, true, false]);
    expect((await get(ana, current)).rated).toBe(false);
  });
});

describe("answers and endings", () => {
  it("no thanks ends it for this battle", async () => {
    await ask(ana);
    expect((await answer(ben, false)).status).toBe("declined");
    await expectDbError(ask(ana), "REMATCH_DECLINED");
    await expectDbError(ask(ben), "REMATCH_DECLINED");
  });

  it("the asker can take it back and ask again", async () => {
    await ask(ana);
    expect(await cancel(ana)).toMatchObject({ status: "cancelled", cancel_reason: "withdrawn" });
    await expectDbError(answer(ben, true), "REMATCH_GONE");
    expect((await ask(ana)).status).toBe("pending");
  });

  it("closes 60 seconds after the battle ended", async () => {
    const window = Date.parse((await get(ana)).window_ends_at);
    expect(window - Date.now()).toBeGreaterThan(50_000);
    await ask(ana);
    await db.query(
      "update public.battles set finished_at = now() - interval '61 seconds' where id = $1",
      [battle],
    );
    await db.query("update public.rematches set expires_at = now() - interval '1 second'");
    await expectDbError(answer(ben, true), "REMATCH_EXPIRED");
    expect((await get(ana)).status).toBe("expired");
    await expectDbError(ask(ben), "REMATCH_EXPIRED");
  });

  it("cannot be asked once the window has passed", async () => {
    await db.query(
      "update public.battles set finished_at = now() - interval '61 seconds' where id = $1",
      [battle],
    );
    await expectDbError(ask(ana), "REMATCH_EXPIRED");
  });

  it("ends when either player starts another battle", async () => {
    await ask(ana);
    const other = await createUser(db, "other");
    await makeBattle(db, ben, other);
    expect(await get(ana)).toMatchObject({ status: "cancelled", cancel_reason: "busy" });
    await expectDbError(ask(ana), "OPPONENT_BUSY");
  });

  it("refuses when the opponent is already in another battle", async () => {
    const other = await createUser(db, "other");
    await makeBattle(db, ben, other);
    await expectDbError(ask(ana), "OPPONENT_BUSY");
  });

  it("only after the battle, and only for its two players", async () => {
    const live = await makeBattle(
      db,
      await createUser(db, "player_x1"),
      await createUser(db, "player_x2"),
    );
    const stranger = await createUser(db, "stranger");
    await expectDbError(ask(stranger), "NOT_PARTICIPANT");
    await expectDbError(get(stranger), "NOT_PARTICIPANT");
    const [x1] = await all<{ user_id: string }>(
      db,
      "select user_id from public.battle_players where battle_id = $1",
      [live],
    );
    await expectDbError(ask(x1!.user_id, live), "BATTLE_NOT_ACTIVE");
  });

  it("the asker cannot answer their own request", async () => {
    await ask(ana);
    await expectDbError(answer(ana, true), "REMATCH_GONE");
  });
});

describe("series score", () => {
  it("counts results between the two players in the last 24 hours", async () => {
    await finishedBattle(ben, ana);
    await finishedBattle(ana, ben);
    expect((await get(ana)).series).toEqual({ you: 2, them: 1, draws: 0 });
    expect((await get(ben)).series).toEqual({ you: 1, them: 2, draws: 0 });
    await db.query("update public.battles set finished_at = now() - interval '25 hours'");
    expect((await get(ana)).series).toEqual({ you: 0, them: 0, draws: 0 });
  });

  it("appears in the rematch battle's state with its number", async () => {
    await ask(ana);
    const next = (await answer(ben, true)).new_battle_id!;
    const state = await call<{ battle: { rematch_of: string; series: Rematch["series"] } }>(
      "public.get_battle_state($1, $2)",
      [ben, next],
    );
    expect(state.battle).toMatchObject({
      rematch_of: battle,
      series: { you: 0, them: 1, draws: 0 },
    });
  });
});

describe("privacy", () => {
  it("only the battle's players can read the offer", async () => {
    await ask(ana);
    const stranger = await createUser(db, "stranger");
    const read = (user: string) =>
      asClient(db, user, () => all(db, "select * from public.rematches"));
    expect(await read(ben)).toHaveLength(1);
    expect(await read(stranger)).toHaveLength(0);
    await expect(
      asClient(db, ana, () => db.query("select public.request_rematch($1, $2)", [ana, battle])),
    ).rejects.toThrow(/permission denied/);
  });
});
