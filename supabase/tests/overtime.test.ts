import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  all,
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
  skipCooldown,
} from "./helpers.ts";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());

// Ratings chosen so the loser's full loss is odd (19): halving shows the rounding.
let fast: string; // 1180, solves first
let slow: string; // 1250
let battle: string;
beforeEach(async () => {
  await resetState(db);
  fast = await createUser(db, "fast_one", 1180);
  slow = await createUser(db, "slow_one", 1250);
  battle = await makeBattle(db, fast, slow);
});

async function solve(user: string) {
  await skipCooldown(db);
  const begun = await beginSubmission(db, user, battle);
  return completeSubmission(db, begun.submission_id, "accepted", begun.total);
}
const profile = (user: string) =>
  one<{ rating: number; wins: number; losses: number }>(
    db,
    "select rating, wins, losses from public.profiles where id = $1",
    [user],
  );
const seat = (user: string) =>
  one<{
    is_active: boolean;
    result: string | null;
    rating_before: number;
    rating_after: number | null;
    solved_in_overtime: boolean;
  }>(
    db,
    `select is_active, result, rating_before, rating_after, solved_in_overtime
     from public.battle_players where battle_id = $1 and user_id = $2`,
    [battle, user],
  );
const battleRow = () =>
  one<{
    status: string;
    winner_id: string;
    overtime_outcome: string | null;
    overtime_seconds: number;
  }>(
    db,
    `select status, winner_id, overtime_outcome,
            round(extract(epoch from (overtime_ends_at - now())))::int as overtime_seconds
     from public.battles where id = $1`,
    [battle],
  );

describe("the first full solve", () => {
  it("wins at once with the full rating gain, and frees the winner", async () => {
    expect((await solve(fast)).battle_finished).toBe(true);
    expect(await profile(fast)).toEqual({ rating: 1199, wins: 1, losses: 0 });
    expect(await seat(fast)).toMatchObject({
      is_active: false,
      result: "win",
      rating_before: 1180,
      rating_after: 1199,
    });
    // The winner can queue for the next battle straight away.
    expect((await findMatch(db, fast)).status).toBe("queued");
  });

  it("gives the other player 2 minutes of overtime, rating untouched for now", async () => {
    await solve(fast);
    const row = await battleRow();
    expect(row).toMatchObject({ status: "active", winner_id: fast, overtime_outcome: null });
    expect(row.overtime_seconds).toBeGreaterThanOrEqual(119);
    expect(row.overtime_seconds).toBeLessThanOrEqual(120);
    expect(await profile(slow)).toEqual({ rating: 1250, wins: 0, losses: 0 });
    expect(await seat(slow)).toMatchObject({ is_active: true, result: null, rating_after: null });
  });

  it("never runs overtime past the original end time", async () => {
    await db.query(
      "update public.battles set ends_at = now() + interval '30 seconds' where id = $1",
      [battle],
    );
    await solve(fast);
    expect((await battleRow()).overtime_seconds).toBeLessThanOrEqual(30);
  });

  it("finishes straight away if no time is left for overtime", async () => {
    const begun = await beginSubmission(db, fast, battle);
    // Judged after the clock ran out (it was submitted in time).
    await db.query(
      "update public.battles set ends_at = now() - interval '1 second' where id = $1",
      [battle],
    );
    await completeSubmission(db, begun.submission_id, "accepted", begun.total);
    expect(await battleRow()).toMatchObject({
      status: "finished",
      winner_id: fast,
      overtime_outcome: "timeout",
    });
    expect(await profile(slow)).toEqual({ rating: 1231, wins: 0, losses: 1 });
  });
});

describe("overtime", () => {
  beforeEach(async () => {
    await solve(fast);
  });

  it("solving it halves the loss, rounded in the loser's favour", async () => {
    expect((await solve(slow)).battle_finished).toBe(true);
    // Full loss would be 19; half is 9.5, rounded toward zero to 9.
    expect(await profile(slow)).toEqual({ rating: 1241, wins: 0, losses: 1 });
    expect(await seat(slow)).toMatchObject({
      result: "loss",
      rating_after: 1241,
      solved_in_overtime: true,
      is_active: false,
    });
    expect(await battleRow()).toMatchObject({ status: "finished", overtime_outcome: "solved" });
    // The winner keeps exactly what they earned.
    expect(await profile(fast)).toEqual({ rating: 1199, wins: 1, losses: 0 });
  });

  it("giving up is the normal loss", async () => {
    await endOvertime(db, battle, "gave_up");
    expect(await profile(slow)).toEqual({ rating: 1231, wins: 0, losses: 1 });
    expect(await battleRow()).toMatchObject({ status: "finished", overtime_outcome: "gave_up" });
    expect((await seat(slow)).solved_in_overtime).toBe(false);
  });

  it("running out of overtime is the normal loss, also via the scheduled sweep", async () => {
    await db.query(
      "update public.battles set overtime_ends_at = now() - interval '1 second' where id = $1",
      [battle],
    );
    const swept = await one<{ n: number }>(db, "select public.finalize_expired_battles() as n");
    expect(swept.n).toBe(1);
    expect(await profile(slow)).toEqual({ rating: 1231, wins: 0, losses: 1 });
    expect(await battleRow()).toMatchObject({ status: "finished", overtime_outcome: "timeout" });
  });

  it("partial submits in overtime only update progress", async () => {
    await skipCooldown(db);
    const begun = await beginSubmission(db, slow, battle);
    expect(
      (await completeSubmission(db, begun.submission_id, "wrong_answer", 1)).battle_finished,
    ).toBe(false);
    expect((await battleRow()).status).toBe("active");
  });

  it("counts a solve that was submitted in time but judged after overtime ended", async () => {
    await skipCooldown(db);
    const begun = await beginSubmission(db, slow, battle);
    await db.query(
      "update public.battles set overtime_ends_at = now() - interval '1 second' where id = $1",
      [battle],
    );
    // The sweep waits for the submission still being judged.
    await db.query("select public.finalize_expired_battles()");
    expect((await battleRow()).status).toBe("active");
    await completeSubmission(db, begun.submission_id, "accepted", begun.total);
    expect(await battleRow()).toMatchObject({ status: "finished", overtime_outcome: "solved" });
  });

  it("nothing more for the winner: no submits, no giving up", async () => {
    await skipCooldown(db);
    await expectDbError(beginSubmission(db, fast, battle), "BATTLE_NOT_ACTIVE");
    await expectDbError(
      db.query("select public.forfeit_battle($1, $2)", [fast, battle]),
      "BATTLE_NOT_ACTIVE",
    );
  });

  it("no submits after overtime ends", async () => {
    await db.query(
      "update public.battles set overtime_ends_at = now() - interval '1 second' where id = $1",
      [battle],
    );
    await skipCooldown(db);
    await expectDbError(beginSubmission(db, slow, battle), "BATTLE_NOT_ACTIVE");
  });

  it("the battle state shows the overtime to both players", async () => {
    const state = (user: string) =>
      one<{
        s: {
          battle: {
            status: string;
            winner_id: string;
            first_solved_at: string;
            overtime_ends_at: string;
            overtime_full_delta: number;
          };
          players: { user_id: string; result: string | null }[];
        };
      }>(db, "select public.get_battle_state($1, $2) as s", [user, battle]);
    const seen = (await state(slow)).s;
    expect(seen.battle).toMatchObject({
      status: "active",
      winner_id: fast,
      overtime_full_delta: -19,
    });
    expect(seen.battle.first_solved_at).toBeTruthy();
    expect(seen.battle.overtime_ends_at).toBeTruthy();
    expect((await state(fast)).s.players[0]).toMatchObject({ user_id: fast, result: "win" });
  });
});

describe("custom matches", () => {
  it("have overtime too, without any rating change", async () => {
    await db.query("update public.battles set is_rated = false where id = $1", [battle]);
    await solve(fast);
    await solve(slow);
    const ratings = await all(
      db,
      "select rating, wins, losses from public.profiles order by rating",
    );
    expect(ratings).toEqual([
      { rating: 1180, wins: 0, losses: 0 },
      { rating: 1250, wins: 0, losses: 0 },
    ]);
    expect(await seat(slow)).toMatchObject({ result: "loss", solved_in_overtime: true });
    expect(await battleRow()).toMatchObject({ status: "finished", overtime_outcome: "solved" });
  });
});
