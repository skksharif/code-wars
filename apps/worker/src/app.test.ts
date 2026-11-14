import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "./app";
import { createSupabaseTokenVerifier } from "./auth";
import { createSupabaseDb, type Db } from "./db";
import type { Env } from "./env";
import { ApiError, DbError, toApiError } from "./errors";

const env: Env = {
  SUPABASE_URL: "https://project.supabase.test/",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  ALLOWED_ORIGINS: "https://codewars.example, http://localhost:5173",
};

const fakeDb: Db = {
  rpc: async () => undefined as never,
  select: async () => [],
};

function makeApp(overrides: Partial<AppDeps> = {}) {
  const app = createApp({
    verifyToken: async (token) => (token === "good-token" ? "user-1" : null),
    createDb: () => fakeDb,
    ...overrides,
  });
  // Routes used only by these tests, registered the way real routes will be.
  app.get("/api/whoami", (c) => c.json({ userId: c.get("userId") }));
  app.post("/api/echo", async (c) => c.json(await c.req.json()));
  app.get("/api/boom", () => {
    throw new Error("secret internal detail: password=hunter2");
  });
  app.get("/api/cooldown", () => {
    throw new DbError("COOLDOWN", "6400");
  });
  app.get("/api/forbidden", () => {
    throw new DbError("NOT_PARTICIPANT");
  });
  return app;
}

const auth = { Authorization: "Bearer good-token" };

afterEach(() => vi.restoreAllMocks());

describe("health", () => {
  it("responds without authentication", async () => {
    const res = await makeApp().request("/api/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("authentication", () => {
  it("rejects requests without a token", async () => {
    const res = await makeApp().request("/api/whoami", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
    });
  });

  it("rejects malformed and invalid tokens", async () => {
    const app = makeApp();
    for (const header of ["good-token", "Basic good-token", "Bearer bad-token", "Bearer "]) {
      const res = await app.request("/api/whoami", { headers: { Authorization: header } }, env);
      expect(res.status, header).toBe(401);
    }
  });

  it("takes the user id from the verified token", async () => {
    const res = await makeApp().request("/api/whoami", { headers: auth }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1" });
  });

  it("protects unknown routes too", async () => {
    const res = await makeApp().request("/api/does-not-exist", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns a generic 500 if the auth service fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp({
      verifyToken: async () => {
        throw new Error("auth down");
      },
    });
    const res = await app.request("/api/whoami", { headers: auth }, env);
    expect(res.status).toBe(500);
  });
});

describe("errors", () => {
  it("returns 404 in the standard format", async () => {
    const res = await makeApp().request("/api/does-not-exist", { headers: auth }, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("never leaks internal error details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await makeApp().request("/api/boom", { headers: auth }, env);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text)).toEqual({
      error: { code: "INTERNAL", message: "Something went wrong." },
    });
    expect(log).toHaveBeenCalled();
  });

  it("maps database error codes to HTTP responses", async () => {
    const app = makeApp();
    const cooldown = await app.request("/api/cooldown", { headers: auth }, env);
    expect(cooldown.status).toBe(429);
    expect(await cooldown.json()).toEqual({
      error: {
        code: "COOLDOWN",
        message: "Wait 7 seconds before trying again.",
        retryAfterMs: 6400,
      },
    });

    const forbidden = await app.request("/api/forbidden", { headers: auth }, env);
    expect(forbidden.status).toBe(403);
  });

  it("treats unknown database errors as internal", () => {
    expect(toApiError(new DbError("relation does not exist")).code).toBe("INTERNAL");
    expect(toApiError(new DbError("INTERNAL")).code).toBe("INTERNAL");
    expect(toApiError("a string").code).toBe("INTERNAL");
    expect(toApiError(new ApiError("NOT_FOUND")).code).toBe("NOT_FOUND");
  });

  it("rejects oversized bodies", async () => {
    const res = await makeApp().request(
      "/api/echo",
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ code: "x".repeat(110 * 1024) }),
      },
      env,
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "PAYLOAD_TOO_LARGE",
    );
  });
});

describe("CORS", () => {
  it("allows listed origins", async () => {
    const res = await makeApp().request(
      "/api/health",
      { headers: { Origin: "https://codewars.example" } },
      env,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://codewars.example");
  });

  it("does not allow other origins", async () => {
    const res = await makeApp().request(
      "/api/health",
      { headers: { Origin: "https://evil.example" } },
      env,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers preflight requests without authentication", async () => {
    const res = await makeApp().request(
      "/api/whoami",
      {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      },
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });
});

describe("Supabase token verifier", () => {
  it("asks Supabase Auth and returns the user id", async () => {
    const fetchFn = vi.fn(async () => Response.json({ id: "user-9" }));
    const verify = createSupabaseTokenVerifier(fetchFn as unknown as typeof fetch);
    expect(await verify("tok", env)).toBe("user-9");
    expect(fetchFn).toHaveBeenCalledWith("https://project.supabase.test/auth/v1/user", {
      headers: { apikey: "service-role-secret", Authorization: "Bearer tok" },
    });
  });

  it("returns null for rejected tokens and throws on outages", async () => {
    const rejected = createSupabaseTokenVerifier(
      (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch,
    );
    expect(await rejected("tok", env)).toBeNull();

    const noId = createSupabaseTokenVerifier((async () =>
      Response.json({})) as unknown as typeof fetch);
    expect(await noId("tok", env)).toBeNull();

    const down = createSupabaseTokenVerifier(
      (async () => new Response("oops", { status: 503 })) as unknown as typeof fetch,
    );
    await expect(down("tok", env)).rejects.toThrow("503");
  });
});

describe("Supabase database client", () => {
  it("calls functions with the service role", async () => {
    const fetchFn = vi.fn(async () => Response.json({ status: "queued" }));
    const db = createSupabaseDb(env, fetchFn as unknown as typeof fetch);
    expect(await db.rpc("find_match", { p_user: "u1" })).toEqual({ status: "queued" });
    expect(fetchFn).toHaveBeenCalledWith("https://project.supabase.test/rest/v1/rpc/find_match", {
      method: "POST",
      headers: {
        apikey: "service-role-secret",
        Authorization: "Bearer service-role-secret",
        "Content-Type": "application/json",
      },
      body: '{"p_user":"u1"}',
    });
  });

  it("reads rows", async () => {
    const fetchFn = vi.fn(async (_url: string) => Response.json([{ id: 1 }]));
    const db = createSupabaseDb(env, fetchFn as unknown as typeof fetch);
    expect(await db.select("battles", "id=eq.1&select=id")).toEqual([{ id: 1 }]);
    expect(fetchFn.mock.calls[0]![0]).toBe(
      "https://project.supabase.test/rest/v1/battles?id=eq.1&select=id",
    );
  });

  it("handles empty responses and raises database errors with their code", async () => {
    const empty = createSupabaseDb(
      env,
      (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    );
    expect(await empty.rpc("cancel_matchmaking")).toBeUndefined();

    const failing = createSupabaseDb(env, (async () =>
      Response.json(
        { message: "COOLDOWN", details: "3000" },
        { status: 400 },
      )) as unknown as typeof fetch);
    await expect(failing.rpc("begin_submission")).rejects.toMatchObject({
      message: "COOLDOWN",
      details: "3000",
    });

    const garbage = createSupabaseDb(
      env,
      (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch,
    );
    await expect(garbage.rpc("x")).rejects.toThrow("Database request failed (502)");
  });
});
