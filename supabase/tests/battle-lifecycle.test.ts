import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  all,
  beginSubmission,
  completeSubmission,
  createDb,
  createUser,
  expectDbError,
  expireBattle,
  findMatch,
  makeBattle,
  one,
  rating,
  resetState,
  submit,
} from "./helpers.ts";

let db: PGlite;
let a: string;
let b: string;
let battle: string;

beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await resetState(db);
  a = await createUser(db, "alice");
  b = await createUser(db, "bob");
  battle = await makeBattle(db, a, b);
});

const setRating = (user: string, value: number) =>
  db.query("update public.profiles set rating = $1 where id = $2", [value, user]);
const finish = async (winner: string | null, reason = "solved") =>
  (
    await one<{ ok: boolean }>(db, "select public.finish_battle($1, $2, $3) as ok", [
      battle,
      winner,
      reason,
    ])
  ).ok;
const finalize = async () =>
  (await one<{ ok: boolean }>(db, "select public.finalize_battle_if_expired($1) as ok", [battle]))
    .ok;
const battleRow = () =>
  one<{ status: string; winner_id: string | null; finish_reason: string | null }>(
    db,
    "select status, winner_id, finish_reason from public.battles where id = $1",
    [battle],
  );
const ratings = async () => [await rating(db, a), await rating(db, b)];

describe("ELO (K=32)", () => {
  it("moves equal players by 16", async () => {
    await finish(a);
    expect(await ratings()).toEqual([1216, 1184]);
  });

  it("rewards an upset more", async () => {
    await setRating(a, 1200);
    await setRating(b, 1400);
    await finish(a);
    expect(await ratings()).toEqual([1224, 1376]);
  });

  it("rewards the favourite less", async () => {
    await setRating(a, 1400);
    await setRating(b, 1200);
    await finish(a);
    expect(await ratings()).toEqual([1408, 1192]);
  });

  it("moves a draw toward the lower-rated player", async () => {
    await setRating(a, 1400);
    await setRating(b, 1200);
    await finish(null, "timeout_draw");
    expect(await ratings()).toEqual([1392, 1208]);
  });

  it("leaves equal players unchanged on a draw", async () => {
    await finish(null, "timeout_draw");
    expect(await ratings()).toEqual([1200, 1200]);
  });

  it("records results, counters and rating history", async () => {
    await finish(a);
    const profiles = await all<{ username: string; wins: number; losses: number; draws: number }>(
      db,
      "select username, wins, losses, draws from public.profiles order by username",
    );
    expect(profiles).toEqual([
      { username: "alice", wins: 1, losses: 0, draws: 0 },
      { username: "bob", wins: 0, losses: 1, draws: 0 },
    ]);
    const history = await all<{ user_id: string; delta: number; result: string }>(
      db,
      "select user_id, delta, result from public.rating_history order by delta desc",
    );
    expect(history).toEqual([
      { user_id: a, delta: 16, result: "win" },
      { user_id: b, delta: -16, result: "loss" },
    ]);
  });
});

describe("finishing a battle", () => {
  it("is idempotent: a second finish changes nothing", async () => {
    expect(await finish(a)).toBe(true);
    expect(await finish(b)).toBe(false);
    expect(await finish(a)).toBe(false);
    expect(await ratings()).toEqual([1216, 1184]);
    expect((await battleRow()).winner_id).toBe(a);
  });

  it("rejects a winner who is not in the battle", async () => {
    const c = await createUser(db, "carol");
    await expectDbError(finish(c), "WINNER_NOT_PARTICIPANT");
  });

  it("frees both players to battle again", async () => {
    await finish(a);
    await findMatch(db, a);
    const again = await findMatch(db, b);
    expect(again.status).toBe("matched");
    expect(again.battle_id).not.toBe(battle);
  });

  it("forfeit gives the opponent the win", async () => {
    await db.query("select public.forfeit_battle($1, $2)", [a, battle]);
    expect(await battleRow()).toEqual({
      status: "finished",
      winner_id: b,
      finish_reason: "forfeit",
    });
    expect(await ratings()).toEqual([1184, 1216]);
  });

  it("forfeit is rejected for outsiders and for finished battles", async () => {
    const c = await createUser(db, "carol");
    await expectDbError(
      db.query("select public.forfeit_battle($1, $2)", [c, battle]),
      "NOT_PARTICIPANT",
    );
    await finish(a);
    await expectDbError(
      db.query("select public.forfeit_battle($1, $2)", [b, battle]),
      "BATTLE_NOT_ACTIVE",
    );
    expect(await ratings()).toEqual([1216, 1184]);
  });
});

describe("time-up", () => {
  it("does nothing before the deadline", async () => {
    expect(await finalize()).toBe(false);
    expect((await battleRow()).status).toBe("active");
  });

  it("awards the win to the player with more hidden tests passed", async () => {
    await submit(db, a, battle, "wrong_answer", 2);
    await submit(db, b, battle, "wrong_answer", 4);
    await expireBattle(db, battle);
    expect(await finalize()).toBe(true);
    expect(await battleRow()).toEqual({
      status: "finished",
      winner_id: b,
      finish_reason: "timeout_score",
    });
  });

  it("is a draw on equal scores, including zero", async () => {
    await expireBattle(db, battle);
    expect(await finalize()).toBe(true);
    expect(await battleRow()).toEqual({
      status: "finished",
      winner_id: null,
      finish_reason: "timeout_draw",
    });
    const results = await all<{ result: string }>(db, "select result from public.battle_players");
    expect(results).toEqual([{ result: "draw" }, { result: "draw" }]);
  });

  it("waits for a submission that started in time, then counts it", async () => {
    const begun = await beginSubmission(db, a, battle);
    await expireBattle(db, battle);
    expect(await finalize()).toBe(false);

    const done = await completeSubmission(db, begun.submission_id, "accepted", begun.total);
    expect(done.battle_finished).toBe(true);
    expect(await battleRow()).toEqual({
      status: "finished",
      winner_id: a,
      finish_reason: "solved",
    });
  });

  it("does not wait forever for a stuck submission", async () => {
    await beginSubmission(db, a, battle);
    await expireBattle(db, battle);
    await db.exec("update public.submissions set created_at = now() - interval '91 seconds'");
    expect(await finalize()).toBe(true);
  });

  it("sweeps every expired battle and only those", async () => {
    const c = await createUser(db, "carol");
    const d = await createUser(db, "dave");
    await makeBattle(db, c, d);
    await expireBattle(db, battle);
    const swept = await one<{ n: number }>(db, "select public.finalize_expired_battles() as n");
    expect(swept.n).toBe(1);
    const statuses = await all<{ status: string }>(
      db,
      "select status from public.battles order by status",
    );
    expect(statuses).toEqual([{ status: "active" }, { status: "finished" }]);
  });

  it("finalises an expired battle when a player searches again", async () => {
    await expireBattle(db, battle);
    expect((await findMatch(db, a)).status).toBe("queued");
    expect((await battleRow()).status).toBe("finished");
  });
});

describe("sweep_stale", () => {
  it("clears stuck submissions and abandoned queue rows", async () => {
    const c = await createUser(db, "carol");
    await findMatch(db, c);
    await beginSubmission(db, a, battle);
    await db.exec(`
      update public.submissions set created_at = now() - interval '91 seconds';
      update public.matchmaking_queue set heartbeat_at = now() - interval '16 seconds';
    `);
    await db.exec("select public.sweep_stale()");
    const sub = await one<{ status: string; verdict: string }>(
      db,
      "select status, verdict from public.submissions",
    );
    expect(sub).toEqual({ status: "error", verdict: "internal_error" });
    expect(await all(db, "select 1 from public.matchmaking_queue")).toHaveLength(0);
  });
});
