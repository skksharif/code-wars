import type { ExecuteRequest, ExecuteResult, JudgeProvider } from "./types";

/**
 * Deterministic stand-in for a real judge, for development and tests only.
 * It does not run code. By default every test passes; put one of these
 * markers anywhere in the source to choose another outcome:
 *
 *   MOCK:PASS=3          first 3 tests pass, the rest give a wrong answer
 *   MOCK:WRONG           every test gives a wrong answer
 *   MOCK:COMPILE_ERROR   MOCK:RUNTIME_ERROR   MOCK:TIME_LIMIT
 *   MOCK:MEMORY_LIMIT    MOCK:INTERNAL_ERROR
 *
 * It must never be used in production: it would accept any submission.
 */
export class MockJudgeProvider implements JudgeProvider {
  readonly name = "mock";

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const source = request.sourceCode;
    const fail = (status: ExecuteResult["status"]): ExecuteResult => ({ status, stdout: "" });

    if (source.includes("MOCK:COMPILE_ERROR")) {
      return { status: "compile_error", stdout: "", compileOutput: "mock: syntax error on line 1" };
    }
    if (source.includes("MOCK:RUNTIME_ERROR")) return fail("runtime_error");
    if (source.includes("MOCK:TIME_LIMIT")) return fail("time_limit");
    if (source.includes("MOCK:MEMORY_LIMIT")) return fail("memory_limit");
    if (source.includes("MOCK:INTERNAL_ERROR")) return fail("internal_error");

    const index = request.mockHint?.index ?? 0;
    const expected = request.mockHint?.expectedOutput ?? "";
    const passCount = /MOCK:PASS=(\d+)/.exec(source);
    const passes = source.includes("MOCK:WRONG")
      ? false
      : passCount
        ? index < Number(passCount[1])
        : true;

    return {
      status: "ok",
      stdout: passes ? expected : "mock-wrong-output",
      timeMs: 10,
      memoryKb: 1024,
    };
  }
}
