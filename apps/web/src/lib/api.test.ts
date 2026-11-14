import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./api";
import { readConfig } from "./config";

function client(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  token: string | null = "tok",
) {
  const spy = vi.fn(fetchFn);
  const api = createApiClient({
    baseUrl: "https://api.test/",
    getToken: async () => token,
    fetchFn: spy as unknown as typeof fetch,
  });
  return { api, spy };
}

describe("API client", () => {
  it("sends the access token and parses results", async () => {
    const { api, spy } = client(async () => Response.json({ status: "queued", waitedMs: 0 }));
    expect(await api.joinMatchmaking()).toEqual({ status: "queued", waitedMs: 0 });
    expect(spy).toHaveBeenCalledWith("https://api.test/api/matchmaking/join", {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("sends code as JSON", async () => {
    const { api, spy } = client(async () =>
      Response.json({
        submissionId: "s",
        verdict: "accepted",
        passed: 5,
        total: 5,
        battleFinished: true,
      }),
    );
    const result = await api.submit("b1", "python", "print(1)");
    expect(result.battleFinished).toBe(true);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://api.test/api/battles/b1/submit");
    expect(init!.headers).toEqual({
      Authorization: "Bearer tok",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init!.body as string)).toEqual({ language: "python", code: "print(1)" });
  });

  it("unwraps simple responses", async () => {
    expect(await client(async () => Response.json({ battleId: "b9" })).api.getActiveBattle()).toBe(
      "b9",
    );
    expect(await client(async () => Response.json({ finished: true })).api.finalize("b")).toBe(
      true,
    );
    await expect(
      client(async () => Response.json({ ok: true })).api.forfeit("b"),
    ).resolves.toBeUndefined();
  });

  it("turns API errors into ApiError with the code and retry time", async () => {
    const { api } = client(async () =>
      Response.json(
        { error: { code: "COOLDOWN", message: "Wait 7 seconds.", retryAfterMs: 6400 } },
        { status: 429 },
      ),
    );
    const error = await api.run("b", "cpp", "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "COOLDOWN",
      message: "Wait 7 seconds.",
      status: 429,
      retryAfterMs: 6400,
    });
  });

  it("handles non-JSON failures and network errors", async () => {
    const html = client(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(html.api.getBattle("b")).rejects.toMatchObject({ code: "INTERNAL", status: 502 });

    const offline = client(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(offline.api.getBattle("b")).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("does not call the server when signed out", async () => {
    const { api, spy } = client(async () => Response.json({}), null);
    await expect(api.joinMatchmaking()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("configuration", () => {
  it("requires all three public values", () => {
    expect(readConfig({})).toBeNull();
    expect(readConfig({ VITE_SUPABASE_URL: "u", VITE_SUPABASE_ANON_KEY: "k" })).toBeNull();
    expect(
      readConfig({
        VITE_SUPABASE_URL: " https://x.supabase.co ",
        VITE_SUPABASE_ANON_KEY: "anon",
        VITE_API_BASE_URL: "http://localhost:8787",
      }),
    ).toEqual({
      supabaseUrl: "https://x.supabase.co",
      supabaseAnonKey: "anon",
      apiBaseUrl: "http://localhost:8787",
    });
  });
});
