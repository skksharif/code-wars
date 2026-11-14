import type { Language } from "@code-wars/shared";

export interface ExecuteRequest {
  language: Language;
  sourceCode: string;
  stdin: string;
  timeLimitMs: number;
  memoryLimitKb: number;
  /**
   * Position of this test and its expected output. Used ONLY by the mock judge
   * to simulate outcomes. Real judges must never send these anywhere: output
   * comparison happens in the Worker so hidden answers stay on our side.
   */
  mockHint?: { index: number; expectedOutput: string };
}

export type ExecuteStatus =
  "ok" | "compile_error" | "runtime_error" | "time_limit" | "memory_limit" | "internal_error";

export interface ExecuteResult {
  status: ExecuteStatus;
  stdout: string;
  compileOutput?: string;
  timeMs?: number;
  memoryKb?: number;
}

/** Runs one program against one input in a sandbox. */
export interface JudgeProvider {
  readonly name: string;
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
}
