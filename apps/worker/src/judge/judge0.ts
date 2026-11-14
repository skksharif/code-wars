import type { Language } from "@code-wars/shared";
import type { ExecuteRequest, ExecuteResult, JudgeProvider } from "./types";

/** Judge0 CE language ids. Verified against the live API in the contract test (Gate 5). */
export const JUDGE0_LANGUAGE_IDS: Record<Language, number> = {
  python: 71, // Python 3.8
  java: 62, // OpenJDK 13
  cpp: 54, // GCC 9.2
  javascript: 63, // Node.js 12
};

export interface Judge0Config {
  apiUrl: string;
  apiKey: string;
  /** Set when calling through RapidAPI; otherwise the key is sent as X-Auth-Token. */
  apiHost?: string;
}

interface Judge0Submission {
  token?: string;
  stdout?: string | null;
  compile_output?: string | null;
  time?: string | null;
  memory?: number | null;
  status?: { id: number };
}

const MAX_POLLS = 10;
const POLL_DELAY_MS = 700;
const FIELDS = "token,stdout,compile_output,time,memory,status";

function toBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string | null | undefined): string {
  if (!value) return "";
  const binary = atob(value.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
}

/**
 * Runs code on a Judge0 instance. Only the source, stdin and limits are sent:
 * no user identity and no expected output.
 */
export class Judge0Provider implements JudgeProvider {
  readonly name = "judge0";

  constructor(
    private readonly config: Judge0Config,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private headers(): Record<string, string> {
    return this.config.apiHost
      ? {
          "Content-Type": "application/json",
          "X-RapidAPI-Key": this.config.apiKey,
          "X-RapidAPI-Host": this.config.apiHost,
        }
      : { "Content-Type": "application/json", "X-Auth-Token": this.config.apiKey };
  }

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const base = this.config.apiUrl.replace(/\/+$/, "");
    const internal: ExecuteResult = { status: "internal_error", stdout: "" };

    const created = await this.fetchFn(
      `${base}/submissions?base64_encoded=true&wait=true&fields=${FIELDS}`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          language_id: JUDGE0_LANGUAGE_IDS[request.language],
          source_code: toBase64(request.sourceCode),
          stdin: toBase64(request.stdin),
          cpu_time_limit: request.timeLimitMs / 1000,
          memory_limit: request.memoryLimitKb,
        }),
      },
    );
    if (!created.ok) return internal;
    let submission = (await created.json()) as Judge0Submission;

    // Status 1 (in queue) and 2 (processing) mean the result is not ready yet.
    for (let poll = 0; (submission.status?.id ?? 0) <= 2; poll++) {
      if (poll >= MAX_POLLS || !submission.token) return internal;
      await this.sleep(POLL_DELAY_MS);
      const response = await this.fetchFn(
        `${base}/submissions/${submission.token}?base64_encoded=true&fields=${FIELDS}`,
        { headers: this.headers() },
      );
      if (!response.ok) return internal;
      submission = (await response.json()) as Judge0Submission;
    }

    return this.toResult(submission, request);
  }

  private toResult(submission: Judge0Submission, request: ExecuteRequest): ExecuteResult {
    const id = submission.status?.id ?? 13;
    const stdout = fromBase64(submission.stdout);
    const timeMs = submission.time ? Math.round(Number(submission.time) * 1000) : undefined;
    const memoryKb = submission.memory ?? undefined;
    const usage = { timeMs, memoryKb };

    // 3 = finished normally. 4 (wrong answer) cannot occur because we never
    // send an expected output, but it also means the program ran to completion.
    if (id === 3 || id === 4) return { status: "ok", stdout, ...usage };
    if (id === 5) return { status: "time_limit", stdout, ...usage };
    if (id === 6) {
      return {
        status: "compile_error",
        stdout: "",
        compileOutput: fromBase64(submission.compile_output),
      };
    }
    if (id >= 7 && id <= 12) {
      // Judge0 reports an exceeded memory limit as a runtime error.
      const overMemory = memoryKb !== undefined && memoryKb >= request.memoryLimitKb;
      return { status: overMemory ? "memory_limit" : "runtime_error", stdout, ...usage };
    }
    return { status: "internal_error", stdout: "" };
  }
}
