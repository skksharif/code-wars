import type { Language, Verdict } from "@code-wars/shared";

/** An error returned by the Worker API, or a network failure (code NETWORK). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export type MatchmakingStatus =
  | { status: "queued"; waitedMs: number }
  | { status: "matched"; battleId: string }
  | { status: "timeout" };

export interface BattlePlayer {
  userId: string;
  username: string;
  isYou: boolean;
  language: Language | null;
  attempts: number;
  bestPassed: number;
  ratingBefore: number;
  ratingAfter: number | null;
  result: "win" | "loss" | "draw" | null;
}

export interface BattleState {
  serverTime: string;
  battle: {
    id: string;
    status: "active" | "finished" | "cancelled";
    startsAt: string;
    endsAt: string;
    finishedAt: string | null;
    winnerId: string | null;
    finishReason: "solved" | "timeout_score" | "timeout_draw" | "forfeit" | null;
  };
  players: BattlePlayer[];
  totalTests: number;
  problem: {
    title: string;
    difficulty: "easy" | "medium" | "hard";
    statementMd: string;
    samples: { input: string; output: string; explanation?: string }[];
    timeLimitMs: number;
    memoryLimitKb: number;
  } | null;
}

export interface RunResult {
  verdict: Verdict;
  passed: number;
  total: number;
  compileOutput?: string;
  cases: { input: string; expected: string; actual: string; status: Verdict }[];
}

export interface SubmitResult {
  submissionId: string;
  verdict: Verdict;
  passed: number;
  total: number;
  compileOutput?: string;
  battleFinished: boolean;
}

export interface ApiClient {
  joinMatchmaking(): Promise<MatchmakingStatus>;
  cancelMatchmaking(): Promise<void>;
  getActiveBattle(): Promise<string | null>;
  getBattle(battleId: string): Promise<BattleState>;
  run(battleId: string, language: Language, code: string): Promise<RunResult>;
  submit(battleId: string, language: Language, code: string): Promise<SubmitResult>;
  forfeit(battleId: string): Promise<void>;
  finalize(battleId: string): Promise<boolean>;
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current Supabase access token, or null when signed out. */
  getToken: () => Promise<string | null>;
  fetchFn?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = await options.getToken();
    if (!token) throw new ApiError("UNAUTHENTICATED", "Sign in to continue.", 401);

    let response: Response;
    try {
      response = await fetchFn(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError("NETWORK", "Could not reach the server. Check your connection.", 0);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // Handled below: a non-JSON body is only acceptable for errors.
    }

    if (!response.ok) {
      const error = (
        payload as { error?: { code?: string; message?: string; retryAfterMs?: number } }
      )?.error;
      throw new ApiError(
        error?.code ?? "INTERNAL",
        error?.message ?? "Something went wrong.",
        response.status,
        error?.retryAfterMs,
      );
    }
    if (payload === null) throw new ApiError("INTERNAL", "Something went wrong.", response.status);
    return payload as T;
  }

  return {
    joinMatchmaking: () => request("POST", "/api/matchmaking/join"),
    cancelMatchmaking: async () => {
      await request("POST", "/api/matchmaking/cancel");
    },
    getActiveBattle: async () =>
      (await request<{ battleId: string | null }>("GET", "/api/battles/active")).battleId,
    getBattle: (id) => request("GET", `/api/battles/${id}`),
    run: (id, language, code) => request("POST", `/api/battles/${id}/run`, { language, code }),
    submit: (id, language, code) =>
      request("POST", `/api/battles/${id}/submit`, { language, code }),
    forfeit: async (id) => {
      await request("POST", `/api/battles/${id}/forfeit`);
    },
    finalize: async (id) =>
      (await request<{ finished: boolean }>("POST", `/api/battles/${id}/finalize`)).finished,
  };
}
