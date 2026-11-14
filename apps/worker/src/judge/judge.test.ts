import { describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { normalizeOutput, outputsMatch } from "./compare";
import { createJudge, judgeDailyLimit } from "./index";
import { Judge0Provider, JUDGE0_LANGUAGE_IDS } from "./judge0";
import { MockJudgeProvider } from "./mock";
import type { ExecuteRequest } from "./types";

const baseEnv: Env = { SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" };
const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

const request = (overrides: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
  language: "python",
  sourceCode: "print('héllo')",
  stdin: "1 2\n",
  timeLimitMs: 2000,
  memoryLimitKb: 128000,
  ...overrides,
});

describe("output comparison", () => {
  it("ignores line endings, trailing spaces and trailing blank lines", () => {
    expect(outputsMatch("1\n2", "1\r\n2\r\n")).toBe(true);
    expect(outputsMatch("a b", "a b   \n\n\n")).toBe(true);
    expect(normalizeOutput("x \t\ny\n")).toBe("x\ny");
  });

  it("is otherwise exact", () => {
    expect(outputsMatch("1 2", "1  2")).toBe(false);
    expect(outputsMatch("YES", "yes")).toBe(false);
    expect(outputsMatch("1\n2", "1\n\n2")).toBe(false);
    expect(outputsMatch("5", " 5")).toBe(false);
    expect(outputsMatch("5", "")).toBe(false);
  });
});

describe("mock judge", () => {
  const judge = new MockJudgeProvider();
  const hint = (index: number) => ({ mockHint: { index, expectedOutput: "42" } });

  it("passes every test by default", async () => {
    expect(await judge.execute(request(hint(3)))).toMatchObject({ status: "ok", stdout: "42" });
  });

  it("follows markers in the source", async () => {
    const run = (sourceCode: string, index = 0) =>
      judge.execute(request({ sourceCode, ...hint(index) }));
    expect((await run("# MOCK:WRONG")).stdout).not.toBe("42");
    expect((await run("# MOCK:PASS=2", 1)).stdout).toBe("42");
    expect((await run("# MOCK:PASS=2", 2)).stdout).not.toBe("42");
    expect((await run("// MOCK:COMPILE_ERROR")).status).toBe("compile_error");
    expect((await run("// MOCK:COMPILE_ERROR")).compileOutput).toBeTruthy();
    expect((await run("// MOCK:RUNTIME_ERROR")).status).toBe("runtime_error");
    expect((await run("// MOCK:TIME_LIMIT")).status).toBe("time_limit");
    expect((await run("// MOCK:MEMORY_LIMIT")).status).toBe("memory_limit");
    expect((await run("// MOCK:INTERNAL_ERROR")).status).toBe("internal_error");
  });
});

describe("judge selection", () => {
  it("has no default, so the mock can never be used by accident", () => {
    expect(() => createJudge(baseEnv)).toThrow("JUDGE_PROVIDER");
    expect(() => createJudge({ ...baseEnv, JUDGE_PROVIDER: "Mock " })).toThrow("JUDGE_PROVIDER");
  });

  it("creates the configured judge", () => {
    expect(createJudge({ ...baseEnv, JUDGE_PROVIDER: "mock" }).name).toBe("mock");
    expect(
      createJudge({
        ...baseEnv,
        JUDGE_PROVIDER: "judge0",
        JUDGE0_API_URL: "https://judge.test",
        JUDGE0_API_KEY: "k",
      }).name,
    ).toBe("judge0");
  });

  it("requires Judge0 credentials", () => {
    expect(() => createJudge({ ...baseEnv, JUDGE_PROVIDER: "judge0" })).toThrow("JUDGE0_API_URL");
  });

  it("applies a daily limit only to the real judge", () => {
    expect(judgeDailyLimit({ ...baseEnv, JUDGE_PROVIDER: "mock" })).toBeNull();
    expect(judgeDailyLimit({ ...baseEnv, JUDGE_PROVIDER: "judge0" })).toBe(50);
    expect(judgeDailyLimit({ ...baseEnv, JUDGE_PROVIDER: "judge0", JUDGE_DAILY_LIMIT: "20" })).toBe(
      20,
    );
    expect(
      judgeDailyLimit({ ...baseEnv, JUDGE_PROVIDER: "judge0", JUDGE_DAILY_LIMIT: "lots" }),
    ).toBe(50);
  });
});

describe("Judge0 provider", () => {
  const config = { apiUrl: "https://judge.test/", apiKey: "secret-key", apiHost: "judge.host" };
  const respond = (body: unknown, status = 200) =>
    vi.fn(async (_url: string, _init?: RequestInit) => Response.json(body, { status }));
  const make = (fetchFn: ReturnType<typeof respond>, cfg = config) =>
    new Judge0Provider(cfg, fetchFn as unknown as typeof fetch, async () => {});

  it("sends only code, input and limits, base64-encoded", async () => {
    const fetchFn = respond({
      status: { id: 3 },
      stdout: b64("héllo\n"),
      time: "0.031",
      memory: 9,
    });
    const result = await make(fetchFn).execute(
      request({ mockHint: { index: 0, expectedOutput: "SECRET-EXPECTED" } }),
    );
    expect(result).toEqual({ status: "ok", stdout: "héllo\n", timeMs: 31, memoryKb: 9 });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toContain("https://judge.test/submissions?base64_encoded=true&wait=true");
    expect(init!.headers).toEqual({
      "Content-Type": "application/json",
      "X-RapidAPI-Key": "secret-key",
      "X-RapidAPI-Host": "judge.host",
    });
    const sent = JSON.parse(init!.body as string);
    expect(sent).toEqual({
      language_id: JUDGE0_LANGUAGE_IDS.python,
      source_code: b64("print('héllo')"),
      stdin: b64("1 2\n"),
      cpu_time_limit: 2,
      memory_limit: 128000,
    });
    expect(init!.body as string).not.toContain("SECRET");
    expect(init!.body as string).not.toContain(b64("SECRET-EXPECTED"));
  });

  it("uses a token header for a self-hosted judge", async () => {
    const fetchFn = respond({ status: { id: 3 }, stdout: null });
    await make(fetchFn, { apiUrl: "https://judge.test", apiKey: "tok" } as typeof config).execute(
      request(),
    );
    expect(fetchFn.mock.calls[0]![1]!.headers).toEqual({
      "Content-Type": "application/json",
      "X-Auth-Token": "tok",
    });
  });

  it("maps Judge0 statuses", async () => {
    const status = async (body: Record<string, unknown>) =>
      (await make(respond(body)).execute(request())).status;
    expect(await status({ status: { id: 4 } })).toBe("ok");
    expect(await status({ status: { id: 5 } })).toBe("time_limit");
    expect(await status({ status: { id: 7 } })).toBe("runtime_error");
    expect(await status({ status: { id: 11 } })).toBe("runtime_error");
    expect(await status({ status: { id: 11 }, memory: 128000 })).toBe("memory_limit");
    expect(await status({ status: { id: 13 } })).toBe("internal_error");
    expect(await status({ status: { id: 14 } })).toBe("internal_error");
    expect(await status({})).toBe("internal_error");
  });

  it("returns the compiler output on a compile error", async () => {
    const result = await make(
      respond({ status: { id: 6 }, compile_output: b64("main.cpp:1: error") }),
    ).execute(request({ language: "cpp" }));
    expect(result).toEqual({
      status: "compile_error",
      stdout: "",
      compileOutput: "main.cpp:1: error",
    });
  });

  it("polls until the result is ready", async () => {
    const replies = [
      { token: "abc", status: { id: 1 } },
      { token: "abc", status: { id: 2 } },
      { token: "abc", status: { id: 3 }, stdout: b64("ok") },
    ];
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(replies.shift()),
    );
    const result = await make(fetchFn).execute(request());
    expect(result.stdout).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls[1]![0]).toContain("https://judge.test/submissions/abc?");
  });

  it("gives up as an internal error when the judge fails or never finishes", async () => {
    expect((await make(respond({ message: "quota" }, 429)).execute(request())).status).toBe(
      "internal_error",
    );
    const stuck = respond({ token: "abc", status: { id: 2 } });
    expect((await make(stuck).execute(request())).status).toBe("internal_error");
    expect(stuck.mock.calls.length).toBe(11);
  });
});
