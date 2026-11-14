import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  all,
  asClient,
  beginSubmission,
  completeSubmission,
  createDb,
  createUser,
  expectDbError,
  findMatch,
  makeBattle,
  resetState,
  submit,
} from "./helpers.ts";

let db: PGlite;
let a: string;
let b: string;
let outsider: string;
let battle: string;

beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await resetState(db);
  a = await createUser(db, "alice");
  b = await createUser(db, "bob");
  outsider = await createUser(db, "mallory");
  battle = await makeBattle(db, a, b);
});

const DENIED = /permission denied/;
const count = async (table: string) => (await all(db, `select * from public.${table}`)).length;

describe("anonymous visitors", () => {
  it("can read profiles and the leaderboard", async () => {
    await asClient(db, null, async () => {
      expect(await count("profiles")).toBe(3);
      expect(await count("leaderboard")).toBe(3);
    });
  });

  it("cannot read anything else", async () => {
    await asClient(db, null, async () => {
      for (const table of [
        "problems",
        "problem_tests",
        "battles",
        "battle_players",
        "submissions",
        "matchmaking_queue",
        "judge_usage",
        "rating_history",
      ]) {
        await expectDbError(count(table), DENIED);
      }
    });
  });

  it("can check username availability", async () => {
    await asClient(db, null, async () => {
      const rows = await all<{ ok: boolean }>(
        db,
        "select public.is_username_available('alice') as ok",
      );
      expect(rows).toEqual([{ ok: false }]);
    });
  });
});

describe("signed-in users", () => {
  it("can never read hidden tests, the queue or judge usage", async () => {
    await asClient(db, a, async () => {
      await expectDbError(count("problem_tests"), DENIED);
      await expectDbError(count("matchmaking_queue"), DENIED);
      await expectDbError(count("judge_usage"), DENIED);
    });
  });

  it("see only battles they are in", async () => {
    await asClient(db, a, async () => {
      expect(await count("battles")).toBe(1);
      expect(await count("battle_players")).toBe(2);
    });
    await asClient(db, outsider, async () => {
      expect(await count("battles")).toBe(0);
      expect(await count("battle_players")).toBe(0);
      expect(await count("problems")).toBe(0);
      expect(await count("rating_history")).toBe(0);
    });
  });

  it("see the problem only after the battle starts, and only their own", async () => {
    await asClient(db, a, async () => expect(await count("problems")).toBe(1));

    await db.exec("update public.battles set starts_at = now() + interval '5 seconds'");
    await asClient(db, a, async () => expect(await count("problems")).toBe(0));
  });

  it("cannot see the opponent's code during the battle", async () => {
    await submit(db, a, battle, "wrong_answer", 1);
    await asClient(db, a, async () => expect(await count("submissions")).toBe(1));
    await asClient(db, b, async () => expect(await count("submissions")).toBe(0));
    await asClient(db, outsider, async () => expect(await count("submissions")).toBe(0));
  });

  it("can see the opponent's submitted code after the battle, but not Run attempts", async () => {
    const run = await beginSubmission(db, a, battle, { kind: "run" });
    await completeSubmission(db, run.submission_id, "wrong_answer", 0);
    const begun = await beginSubmission(db, a, battle);
    await completeSubmission(db, begun.submission_id, "accepted", begun.total);

    await asClient(db, b, async () => {
      const rows = await all<{ kind: string; user_id: string }>(
        db,
        "select kind, user_id from public.submissions",
      );
      expect(rows).toEqual([{ kind: "submit", user_id: a }]);
    });
    await asClient(db, outsider, async () => expect(await count("submissions")).toBe(0));
  });

  it("cannot write to any table", async () => {
    await asClient(db, a, async () => {
      await expectDbError(db.query("update public.profiles set rating = 3000"), DENIED);
      await expectDbError(
        db.query("update public.battles set winner_id = $1, status = 'finished'", [a]),
        DENIED,
      );
      await expectDbError(db.query("update public.battle_players set best_passed = 99"), DENIED);
      await expectDbError(db.query("delete from public.submissions"), DENIED);
      await expectDbError(
        db.query(
          `insert into public.submissions (battle_id, user_id, kind, language, source_code, total)
           values ($1, $2, 'submit', 'python', 'x', 5)`,
          [battle, a],
        ),
        DENIED,
      );
      await expectDbError(db.query("delete from public.matchmaking_queue"), DENIED);
    });
  });

  it("cannot call trusted functions directly", async () => {
    await asClient(db, a, async () => {
      await expectDbError(findMatch(db, a), DENIED);
      await expectDbError(
        db.query("select public.finish_battle($1, $2, 'solved')", [battle, a]),
        DENIED,
      );
      await expectDbError(db.query("select public.forfeit_battle($1, $2)", [b, battle]), DENIED);
      await expectDbError(beginSubmission(db, a, battle), DENIED);
      await expectDbError(
        db.query("select public.complete_submission($1, 'accepted', 5)", [battle]),
        DENIED,
      );
      await expectDbError(db.query("select public.finalize_expired_battles()"), DENIED);
      await expectDbError(db.query("select public.sweep_stale()"), DENIED);
      await expectDbError(db.query("select public.cancel_matchmaking($1)", [b]), DENIED);
    });
  });
});

describe("service role (the Worker)", () => {
  it("can call trusted functions and read hidden tests", async () => {
    await db.exec("set role service_role");
    try {
      expect(await count("problem_tests")).toBeGreaterThan(0);
      const begun = await beginSubmission(db, a, battle);
      await completeSubmission(db, begun.submission_id, "wrong_answer", 0);
    } finally {
      await db.exec("reset role");
    }
  });
});
