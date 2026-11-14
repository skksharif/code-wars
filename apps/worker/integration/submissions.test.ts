import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, createUser, makeBattle, resetState } from "../../../supabase/tests/helpers.ts";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import { MockJudgeProvider } from "../src/judge/mock";
import type { ExecuteRequest, JudgeProvider } from "../src/judge/types";
import { createPgliteDb } from "./pglite-db";

const mockEnv: Env = {
  SUPABASE_URL: "http://unused.test",
  SUPABASE_SERVICE_ROLE_KEY: "unused",
  JUDGE_PROVIDER: "mock",
};

let pg: PGlite;
let alice: string;
let bob: string;
let battle: string;
let executions: ExecuteRequest[];
let judge: JudgeProvider;

function makeApp() {
  return createApp({
    verifyToken: async (token) => (/^[0-9a-f-]{36}$/.test(token) ? token : null),
    createDb: () => createPgliteDb(pg),
    createJudge: () => judge,
  });
}

beforeAll(async () => {
  pg = await createDb();
});
afterAll(() => pg.close());
beforeEach(async () => {
  await resetState(pg);
  alice = await createUser(pg, "alice");
  bob = await createUser(pg, "bob");
  battle = await makeBattle(pg, alice, bob);
  executions = [];
  const mock = new MockJudgeProvider();
  judge = {
    name: "mock",
    execute: (req) => {
      executions.push(req);
      return mock.execute(req);
    },
  };
});
afterEach(() => vi.restoreAllMocks());

type Body = Record<string, unknown> & { error?: { code: string; retryAfterMs?: number } };

async function post(
  user: string,
  kind: "run" | "submit",
  payload: unknown,
  options: { battleId?: string; env?: Env } = {},
) {
  const res = await makeApp().request(
    `/api/battles/${options.battleId ?? battle}/${kind}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    },
    options.env ?? mockEnv,
  );
  return { status: res.status, body: (await res.json()) as Body };
}

const code = (source: string) => ({ language: "python", code: source });
const player = async (user: string) =>
  (
    await pg.query<{ attempts: number; best_passed: number }>(
      "select attempts, best_passed from public.battle_players where battle_id = $1 and user_id = $2",
      [battle, user],
    )
  ).rows[0]!;
const battleStatus = async () =>
  (
    await pg.query<{ status: string; winner_id: string | null }>(
      "select status, winner_id from public.battles where id = $1",
      [battle],
    )
  ).rows[0]!;
const hiddenTotal = async () =>
  (
    await pg.query<{ n: number }>(
      `select count(*)::int as n from public.problem_tests t
       join public.battles b on b.problem_id = t.problem_id where b.id = $1`,
      [battle],
    )
  ).rows[0]!.n;

describe("Run (sample tests)", () => {
  it("shows each sample with expected and actual output", async () => {
    const res = await post(alice, "run", code("print(1)"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ verdict: "accepted", passed: 2, total: 2 });
    const cases = res.body.cases as { input: string; expected: string; actual: string }[];
    expect(cases).toHaveLength(2);
    expect(cases[0]!.actual).toBe(cases[0]!.expected);
    expect(cases[0]!.input.length).toBeGreaterThan(0);
  });

  it("does not count as an attempt or end the battle", async () => {
    await post(alice, "run", code("print(1)"));
    expect(await player(alice)).toEqual({ attempts: 0, best_passed: 0 });
    expect((await battleStatus()).status).toBe("active");
  });

  it("reports a wrong answer per sample", async () => {
    const res = await post(alice, "run", code("# MOCK:PASS=1"));
    expect(res.body).toMatchObject({ verdict: "wrong_answer", passed: 1, total: 2 });
    const cases = res.body.cases as { status: string }[];
    expect(cases.map((c) => c.status)).toEqual(["accepted", "wrong_answer"]);
  });
});

describe("Submit (hidden tests)", () => {
  it("runs every hidden test and records partial progress", async () => {
    const total = await hiddenTotal();
    const res = await post(alice, "submit", code("# MOCK:PASS=3"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      verdict: "wrong_answer",
      passed: 3,
      total,
      battleFinished: false,
    });
    expect(executions).toHaveLength(total);
    expect(await player(alice)).toEqual({ attempts: 1, best_passed: 3 });
  });

  it("never reveals hidden inputs or expected outputs", async () => {
    const res = await post(alice, "submit", code("# MOCK:PASS=3"));
    expect(Object.keys(res.body).sort()).toEqual([
      "battleFinished",
      "passed",
      "submissionId",
      "total",
      "verdict",
    ]);
  });

  it("a full solve wins the battle and updates ratings", async () => {
    const res = await post(alice, "submit", code("print('solved')"));
    expect(res.body).toMatchObject({ verdict: "accepted", battleFinished: true });
    expect(await battleStatus()).toEqual({ status: "finished", winner_id: alice });
    const ratings = await pg.query<{ username: string; rating: number }>(
      "select username, rating from public.profiles order by username",
    );
    expect(ratings.rows).toEqual([
      { username: "alice", rating: 1216 },
      { username: "bob", rating: 1184 },
    ]);
    // The loser cannot keep submitting.
    const late = await post(bob, "submit", code("print(1)"));
    expect(late.status).toBe(409);
    expect(late.body.error!.code).toBe("BATTLE_NOT_ACTIVE");
  });

  it("stops after one execution on a compile error and shows the compiler output", async () => {
    const res = await post(alice, "submit", code("# MOCK:COMPILE_ERROR"));
    expect(res.body).toMatchObject({ verdict: "compile_error", passed: 0 });
    expect(res.body.compileOutput).toContain("syntax error");
    expect(executions).toHaveLength(1);
    expect(await player(alice)).toEqual({ attempts: 1, best_passed: 0 });
  });

  it("reports runtime errors and time limits", async () => {
    expect((await post(alice, "submit", code("# MOCK:RUNTIME_ERROR"))).body.verdict).toBe(
      "runtime_error",
    );
    expect((await post(bob, "submit", code("# MOCK:TIME_LIMIT"))).body.verdict).toBe("time_limit");
  });

  it("passes the problem's limits and the chosen language to the judge", async () => {
    await post(alice, "submit", { language: "cpp", code: "int main(){}" });
    expect(executions[0]).toMatchObject({
      language: "cpp",
      sourceCode: "int main(){}",
      timeLimitMs: 2000,
      memoryLimitKb: 128000,
    });
  });
});

describe("judge failures", () => {
  it("does not count the submission when the judge reports an internal error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(alice, "submit", code("# MOCK:INTERNAL_ERROR"));
    expect(res.status).toBe(502);
    expect(res.body.error!.code).toBe("JUDGE_UNAVAILABLE");
    expect(await player(alice)).toEqual({ attempts: 0, best_passed: 0 });
    // No cooldown and nothing stuck: the player can retry at once.
    expect((await post(alice, "submit", code("# MOCK:PASS=1"))).status).toBe(200);
  });

  it("does not count the submission when the judge throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    judge = {
      name: "broken",
      execute: async () => {
        throw new Error("network down");
      },
    };
    const res = await post(alice, "submit", code("print(1)"));
    expect(res.status).toBe(502);
    const row = await pg.query<{ status: string }>("select status from public.submissions");
    expect(row.rows).toEqual([{ status: "error" }]);
  });
});

describe("rules enforced before judging", () => {
  it("rejects invalid requests without calling the judge", async () => {
    const bad = [
      { language: "rust", code: "x" },
      { language: "python", code: "" },
      { language: "python" },
      { language: "python", code: "x".repeat(65537) },
      "not json",
    ];
    for (const payload of bad) {
      const res = await post(alice, "submit", payload);
      expect(res.status, JSON.stringify(payload).slice(0, 40)).toBe(400);
      expect(res.body.error!.code).toBe("INVALID_INPUT");
    }
    expect((await post(alice, "submit", code("x"), { battleId: "not-a-uuid" })).status).toBe(400);
    expect(executions).toHaveLength(0);
  });

  it("rejects players who are not in the battle", async () => {
    const carol = await createUser(pg, "carol");
    const res = await post(carol, "submit", code("print(1)"));
    expect(res.status).toBe(403);
    expect(executions).toHaveLength(0);
  });

  it("returns 404 for an unknown battle", async () => {
    const res = await post(alice, "submit", code("x"), {
      battleId: "00000000-0000-4000-8000-000000000000",
    });
    expect(res.status).toBe(404);
  });

  it("rejects submissions before the battle starts", async () => {
    await pg.exec("update public.battles set starts_at = now() + interval '5 seconds'");
    const res = await post(alice, "submit", code("print(1)"));
    expect(res.status).toBe(409);
    expect(res.body.error!.code).toBe("BATTLE_NOT_STARTED");
  });

  it("enforces the cooldown with a retry time", async () => {
    await post(alice, "submit", code("# MOCK:PASS=1"));
    const res = await post(alice, "submit", code("# MOCK:PASS=2"));
    expect(res.status).toBe(429);
    expect(res.body.error!.code).toBe("COOLDOWN");
    expect(res.body.error!.retryAfterMs).toBeGreaterThan(8000);
    expect(res.body.error!.retryAfterMs).toBeLessThanOrEqual(10000);
  });

  it("enforces the daily judge quota for the real judge and refunds unused executions", async () => {
    const total = await hiddenTotal();
    const judge0Env = (limit: number): Env => ({
      ...mockEnv,
      JUDGE_PROVIDER: "judge0",
      JUDGE_DAILY_LIMIT: String(limit),
    });
    const usage = async () =>
      (await pg.query<{ executions: number }>("select executions from public.judge_usage")).rows[0]
        ?.executions ?? 0;

    const refused = await post(alice, "submit", code("x"), { env: judge0Env(total - 1) });
    expect(refused.status).toBe(429);
    expect(refused.body.error!.code).toBe("JUDGE_QUOTA_EXHAUSTED");
    expect(executions).toHaveLength(0);

    await post(alice, "submit", code("# MOCK:COMPILE_ERROR"), { env: judge0Env(50) });
    expect(await usage()).toBe(1);

    await post(bob, "submit", code("# MOCK:PASS=1"), { env: judge0Env(50) });
    expect(await usage()).toBe(1 + total);
  });
});
