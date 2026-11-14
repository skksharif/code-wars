import type { Env } from "../env";
import { Judge0Provider } from "./judge0";
import { MockJudgeProvider } from "./mock";
import type { JudgeProvider } from "./types";

export type JudgeFactory = (env: Env) => JudgeProvider;

/**
 * Chooses the judge from configuration. There is no default: a missing or
 * unknown JUDGE_PROVIDER is an error, so a misconfigured deployment can never
 * silently fall back to the mock judge (which accepts everything).
 */
export function createJudge(env: Env): JudgeProvider {
  if (env.JUDGE_PROVIDER === "mock") return new MockJudgeProvider();
  if (env.JUDGE_PROVIDER === "judge0") {
    if (!env.JUDGE0_API_URL || !env.JUDGE0_API_KEY) {
      throw new Error("JUDGE0_API_URL and JUDGE0_API_KEY are required when JUDGE_PROVIDER=judge0");
    }
    return new Judge0Provider({
      apiUrl: env.JUDGE0_API_URL,
      apiKey: env.JUDGE0_API_KEY,
      apiHost: env.JUDGE0_API_HOST || undefined,
    });
  }
  throw new Error("JUDGE_PROVIDER must be 'mock' or 'judge0'");
}

/** Daily execution budget passed to the database; null means unlimited (mock judge). */
export function judgeDailyLimit(env: Env): number | null {
  if (env.JUDGE_PROVIDER !== "judge0") return null;
  const limit = Number(env.JUDGE_DAILY_LIMIT ?? "50");
  return Number.isInteger(limit) && limit > 0 ? limit : 50;
}
