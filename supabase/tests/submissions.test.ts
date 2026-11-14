import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  beginSubmission,
  completeSubmission,
  createDb,
  createUser,
  expectDbError,
  expireBattle,
  makeBattle,
  one,
  resetState,
  skipCooldown,
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

const player = (user: string) =>
  one<{ attempts: number; best_passed: number; language: string | null }>(
    db,
    "select attempts, best_passed, language from public.battle_players where battle_id = $1 and user_id = $2",
    [battle, user],
  );
const usage = async () =>
  (await one<{ n: number } | undefined>(db, "select executions as n from public.judge_usage"))?.n ??
  0;

describe("begin_submission", () => {
  it("records a judging submission with the hidden test count", async () => {
    const begun = await beginSubmission(db, a, battle);
    expect(begun.total).toBeGreaterThanOrEqual(5);
    expect(begun.time_limit_ms).toBe(2000);
    const row = await one<{ status: string; kind: string }>(
      db,
      "select status, kind from public.submissions where id = $1",
      [begun.submission_id],
    );
    expect(row).toEqual({ status: "judging", kind: "submit" });
  });

  it("uses the sample count for Run", async () => {
    const begun = await beginSubmission(db, a, battle, { kind: "run" });
    expect(begun.total).toBe(2);
  });

  it("rejects non-participants", async () => {
    const c = await createUser(db, "carol");
    await expectDbError(beginSubmission(db, c, battle), "NOT_PARTICIPANT");
  });

  it("rejects submissions before the battle starts", async () => {
    await db.exec("update public.battles set starts_at = now() + interval '5 seconds'");
    await expectDbError(beginSubmission(db, a, battle), "BATTLE_NOT_STARTED");
  });

  it("rejects submissions after the deadline, by database time", async () => {
    await expireBattle(db, battle);
    await expectDbError(beginSubmission(db, a, battle), "BATTLE_NOT_ACTIVE");
  });

  it("rejects bad input", async () => {
    await expectDbError(beginSubmission(db, a, battle, { language: "rust" }), "INVALID_INPUT");
    await expectDbError(beginSubmission(db, a, battle, { kind: "cheat" }), "INVALID_INPUT");
    await expectDbError(beginSubmission(db, a, battle, { code: "" }), "INVALID_INPUT");
    await expectDbError(
      beginSubmission(db, a, battle, { code: "x".repeat(65537) }),
      "INVALID_INPUT",
    );
  });

  it("allows only one submission in flight per user", async () => {
    await beginSubmission(db, a, battle);
    await expectDbError(beginSubmission(db, a, battle, { kind: "run" }), "SUBMISSION_IN_FLIGHT");
    // The opponent is not affected.
    await beginSubmission(db, b, battle);
  });

  it("enforces the in-flight rule with a unique index as well", async () => {
    await beginSubmission(db, a, battle);
    await expectDbError(
      db.query(
        `insert into public.submissions (battle_id, user_id, kind, language, source_code, total)
         values ($1, $2, 'submit', 'python', 'x', 5)`,
        [battle, a],
      ),
      "submissions_one_judging_per_user",
    );
  });

  it("recovers from a submission stuck in judging for over 90 seconds", async () => {
    const stuck = await beginSubmission(db, a, battle);
    await db.exec("update public.submissions set created_at = now() - interval '91 seconds'");
    await beginSubmission(db, a, battle);
    const row = await one<{ status: string }>(
      db,
      "select status from public.submissions where id = $1",
      [stuck.submission_id],
    );
    expect(row.status).toBe("error");
  });

  it("applies a 10 s cooldown to Submit and 5 s to Run, separately", async () => {
    const first = await beginSubmission(db, a, battle);
    await completeSubmission(db, first.submission_id, "wrong_answer", 1);
    await expectDbError(beginSubmission(db, a, battle), "COOLDOWN");

    const run = await beginSubmission(db, a, battle, { kind: "run" });
    await completeSubmission(db, run.submission_id, "wrong_answer", 0);
    await expectDbError(beginSubmission(db, a, battle, { kind: "run" }), "COOLDOWN");

    await db.exec("update public.submissions set created_at = created_at - interval '6 seconds'");
    await expectDbError(beginSubmission(db, a, battle), "COOLDOWN");
    await beginSubmission(db, a, battle, { kind: "run" });
  });

  it("reserves judge quota and refuses when the daily limit would be exceeded", async () => {
    const begun = await beginSubmission(db, a, battle, { dailyLimit: 50 });
    expect(await usage()).toBe(begun.total);
    await expectDbError(
      beginSubmission(db, b, battle, { dailyLimit: begun.total + 1 }),
      "JUDGE_QUOTA_EXHAUSTED",
    );
    // The refused attempt left nothing behind.
    expect(await usage()).toBe(begun.total);
    const count = await one<{ n: number }>(db, "select count(*)::int as n from public.submissions");
    expect(count.n).toBe(1);
  });

  it("returns unused judge quota on completion", async () => {
    const begun = await beginSubmission(db, a, battle, { dailyLimit: 50 });
    await completeSubmission(db, begun.submission_id, "compile_error", 0, 1);
    expect(await usage()).toBe(1);
  });

  it("does not track quota for the mock judge", async () => {
    await beginSubmission(db, a, battle);
    expect(await usage()).toBe(0);
  });
});

describe("complete_submission", () => {
  it("updates attempts, language and best score", async () => {
    await submit(db, a, battle, "wrong_answer", 3);
    await submit(db, a, battle, "runtime_error", 1);
    expect(await player(a)).toEqual({ attempts: 2, best_passed: 3, language: "python" });
    expect(await player(b)).toEqual({ attempts: 0, best_passed: 0, language: null });
  });

  it("does not count Run attempts", async () => {
    const run = await beginSubmission(db, a, battle, { kind: "run" });
    await completeSubmission(db, run.submission_id, "accepted", run.total);
    expect((await player(a)).attempts).toBe(0);
    const status = await one<{ status: string }>(db, "select status from public.battles");
    expect(status.status).toBe("active");
  });

  it("ends the battle immediately on a full solve", async () => {
    const begun = await beginSubmission(db, a, battle);
    const result = await completeSubmission(db, begun.submission_id, "accepted", begun.total);
    expect(result.battle_finished).toBe(true);
    const row = await one<{ status: string; winner_id: string; finish_reason: string }>(
      db,
      "select status, winner_id, finish_reason from public.battles where id = $1",
      [battle],
    );
    expect(row).toEqual({ status: "finished", winner_id: a, finish_reason: "solved" });
  });

  it("cannot be applied twice", async () => {
    const begun = await beginSubmission(db, a, battle);
    await completeSubmission(db, begun.submission_id, "wrong_answer", 2);
    await expectDbError(
      completeSubmission(db, begun.submission_id, "accepted", begun.total),
      "SUBMISSION_NOT_JUDGING",
    );
  });

  it("rejects inconsistent results", async () => {
    const begun = await beginSubmission(db, a, battle);
    await expectDbError(
      completeSubmission(db, begun.submission_id, "accepted", 1),
      "INVALID_INPUT",
    );
    await expectDbError(
      completeSubmission(db, begun.submission_id, "wrong_answer", begun.total),
      "INVALID_INPUT",
    );
    await expectDbError(
      completeSubmission(db, begun.submission_id, "wrong_answer", begun.total + 1),
      "INVALID_INPUT",
    );
  });

  it("does not count a judge failure against the player", async () => {
    const begun = await beginSubmission(db, a, battle);
    await completeSubmission(db, begun.submission_id, "internal_error", 0);
    expect((await player(a)).attempts).toBe(0);
    // No cooldown either: the player can retry straight away.
    await beginSubmission(db, a, battle);
  });

  it("gives the win to whoever completes a full solve first", async () => {
    const first = await beginSubmission(db, a, battle);
    const second = await beginSubmission(db, b, battle);
    await completeSubmission(db, second.submission_id, "accepted", second.total);
    const late = await completeSubmission(db, first.submission_id, "accepted", first.total);
    expect(late.battle_finished).toBe(false);
    const row = await one<{ winner_id: string }>(db, "select winner_id from public.battles");
    expect(row.winner_id).toBe(b);
  });

  it("lets a player submit again after the cooldown", async () => {
    await submit(db, a, battle, "wrong_answer", 1);
    await skipCooldown(db);
    await beginSubmission(db, a, battle);
  });
});
