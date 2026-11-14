import { LANGUAGES, LIMITS, type Language, type Verdict } from "@code-wars/shared";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../app";
import { ApiError } from "../errors";
import { outputsMatch } from "../judge/compare";
import { judgeDailyLimit, type JudgeFactory } from "../judge/index";
import type { ExecuteResult, JudgeProvider } from "../judge/types";

const bodySchema = z.object({
  language: z.enum(LANGUAGES),
  code: z.string().min(1).max(LIMITS.maxCodeBytes),
});
const uuidSchema = z.string().uuid();

const MAX_SHOWN_OUTPUT = 2000;

interface BeginResult {
  submission_id: string;
  problem_id: string;
  total: number;
  time_limit_ms: number;
  memory_limit_kb: number;
}

interface TestCase {
  input: string;
  expected: string;
}

interface CaseOutcome {
  status: Verdict;
  actual: string;
}

interface JudgeOutcome {
  verdict: Verdict;
  passed: number;
  compileOutput?: string;
  executionsUsed: number;
  cases: CaseOutcome[];
}

function caseVerdict(result: ExecuteResult, expected: string): Verdict {
  if (result.status !== "ok") return result.status;
  return outputsMatch(expected, result.stdout) ? "accepted" : "wrong_answer";
}

/**
 * Runs every test. The first test runs alone so a compile error or judge
 * outage costs one execution; the remaining tests then run in parallel.
 */
async function judgeAll(
  judge: JudgeProvider,
  tests: TestCase[],
  language: Language,
  code: string,
  limits: { timeLimitMs: number; memoryLimitKb: number },
): Promise<JudgeOutcome> {
  const run = (test: TestCase, index: number) =>
    judge.execute({
      language,
      sourceCode: code,
      stdin: test.input,
      ...limits,
      mockHint: { index, expectedOutput: test.expected },
    });

  const results: ExecuteResult[] = [];
  if (tests.length > 0) {
    results.push(await run(tests[0]!, 0));
    const first = results[0]!;
    if (first.status === "compile_error" || first.status === "internal_error") {
      return {
        verdict: first.status,
        passed: 0,
        compileOutput: first.compileOutput,
        executionsUsed: 1,
        cases: [{ status: first.status, actual: "" }],
      };
    }
    results.push(...(await Promise.all(tests.slice(1).map((test, i) => run(test, i + 1)))));
  }

  const cases = results.map((result, i) => ({
    status: caseVerdict(result, tests[i]!.expected),
    actual: result.stdout.slice(0, MAX_SHOWN_OUTPUT),
  }));
  const passed = cases.filter((c) => c.status === "accepted").length;
  const failures = cases.filter((c) => c.status !== "accepted");
  const verdict: Verdict = failures.some((c) => c.status === "internal_error")
    ? "internal_error"
    : (failures[0]?.status ?? (tests.length > 0 ? "accepted" : "internal_error"));

  return { verdict, passed, executionsUsed: results.length, cases };
}

export function registerSubmissionRoutes(app: Hono<AppContext>, createJudge: JudgeFactory): void {
  async function handle(c: Context<AppContext>, kind: "run" | "submit") {
    const battleId = uuidSchema.safeParse(c.req.param("id"));
    const body = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!battleId.success || !body.success) throw new ApiError("INVALID_INPUT");

    const db = c.get("db");
    const { language, code } = body.data;

    // Every rule (participant, deadline, cooldown, one in flight, quota) is
    // enforced here by the database before any code reaches the judge.
    const begun = await db.rpc<BeginResult>("begin_submission", {
      p_user: c.get("userId"),
      p_battle: battleId.data,
      p_kind: kind,
      p_language: language,
      p_code: code,
      p_daily_limit: judgeDailyLimit(c.env),
    });

    let outcome: JudgeOutcome;
    let tests: TestCase[] = [];
    try {
      if (kind === "run") {
        const rows = await db.select<{ samples: { input: string; output: string }[] }>(
          "problems",
          `id=eq.${begun.problem_id}&select=samples`,
        );
        tests = (rows[0]?.samples ?? []).map((s) => ({ input: s.input, expected: s.output }));
      } else {
        const rows = await db.select<{ input: string; expected_output: string }>(
          "problem_tests",
          `problem_id=eq.${begun.problem_id}&select=input,expected_output&order=ordinal.asc`,
        );
        tests = rows.map((t) => ({ input: t.input, expected: t.expected_output }));
      }
      outcome = await judgeAll(createJudge(c.env), tests, language, code, {
        timeLimitMs: begun.time_limit_ms,
        memoryLimitKb: begun.memory_limit_kb,
      });
    } catch (error) {
      console.error("Judging failed", error);
      outcome = { verdict: "internal_error", passed: 0, executionsUsed: 0, cases: [] };
    }

    const failed = outcome.verdict === "internal_error";
    const completed = await db.rpc<{ battle_finished: boolean }>("complete_submission", {
      p_submission: begun.submission_id,
      p_verdict: outcome.verdict,
      p_passed: failed ? 0 : outcome.passed,
      p_compile_output: outcome.compileOutput ?? null,
      p_executions_used: outcome.executionsUsed,
    });
    if (failed) throw new ApiError("JUDGE_UNAVAILABLE");

    const common = {
      verdict: outcome.verdict,
      passed: outcome.passed,
      total: begun.total,
      ...(outcome.compileOutput ? { compileOutput: outcome.compileOutput.slice(0, 4000) } : {}),
    };

    if (kind === "run") {
      // Sample tests are public, so their inputs and outputs can be shown.
      return c.json({
        ...common,
        cases: outcome.cases.map((result, i) => ({
          input: tests[i]!.input,
          expected: tests[i]!.expected,
          actual: result.actual,
          status: result.status,
        })),
      });
    }
    // Hidden tests: counts only. No inputs, outputs or per-test detail.
    return c.json({
      submissionId: begun.submission_id,
      ...common,
      battleFinished: completed.battle_finished,
    });
  }

  app.post("/api/battles/:id/run", (c) => handle(c, "run"));
  app.post("/api/battles/:id/submit", (c) => handle(c, "submit"));
}
