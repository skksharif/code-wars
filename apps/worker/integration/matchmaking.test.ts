import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, createUser, resetState } from "../../../supabase/tests/helpers.ts";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import { createPgliteDb } from "./pglite-db";

const env: Env = { SUPABASE_URL: "http://unused.test", SUPABASE_SERVICE_ROLE_KEY: "unused" };

let pg: PGlite;
let app: ReturnType<typeof createApp>;
let alice: string;
let bob: string;

beforeAll(async () => {
  pg = await createDb();
  // In these tests the bearer token is simply the user id.
  app = createApp({
    verifyToken: async (token) => (/^[0-9a-f-]{36}$/.test(token) ? token : null),
    createDb: () => createPgliteDb(pg),
  });
});
afterAll(() => pg.close());
beforeEach(async () => {
  await resetState(pg);
  alice = await createUser(pg, "alice");
  bob = await createUser(pg, "bob");
});

async function call(user: string | null, method: string, path: string) {
  const res = await app.request(
    path,
    { method, headers: user ? { Authorization: `Bearer ${user}` } : {} },
    env,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("matchmaking API against the real database functions", () => {
  it("queues the first player, matches the second, and informs the first", async () => {
    const first = await call(alice, "POST", "/api/matchmaking/join");
    expect(first).toEqual({ status: 200, body: { status: "queued", waitedMs: 0 } });

    const second = await call(bob, "POST", "/api/matchmaking/join");
    expect(second.body.status).toBe("matched");
    expect(second.body.battleId).toMatch(/^[0-9a-f-]{36}$/);

    const heartbeat = await call(alice, "POST", "/api/matchmaking/join");
    expect(heartbeat.body).toEqual({ status: "matched", battleId: second.body.battleId });
  });

  it("requires sign-in", async () => {
    expect((await call(null, "POST", "/api/matchmaking/join")).status).toBe(401);
    expect((await call(null, "POST", "/api/matchmaking/cancel")).status).toBe(401);
    expect((await call(null, "GET", "/api/battles/active")).status).toBe(401);
  });

  it("cancels a search", async () => {
    await call(alice, "POST", "/api/matchmaking/join");
    expect(await call(alice, "POST", "/api/matchmaking/cancel")).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect((await call(bob, "POST", "/api/matchmaking/join")).body.status).toBe("queued");
  });

  it("reports a timeout after 60 seconds", async () => {
    await call(alice, "POST", "/api/matchmaking/join");
    await pg.exec("update public.matchmaking_queue set joined_at = now() - interval '61 seconds'");
    expect((await call(alice, "POST", "/api/matchmaking/join")).body).toEqual({
      status: "timeout",
    });
  });

  it("reports the active battle, only to its players", async () => {
    expect((await call(alice, "GET", "/api/battles/active")).body).toEqual({ battleId: null });

    await call(alice, "POST", "/api/matchmaking/join");
    const matched = await call(bob, "POST", "/api/matchmaking/join");

    expect((await call(alice, "GET", "/api/battles/active")).body).toEqual({
      battleId: matched.body.battleId,
    });
    const carol = await createUser(pg, "carol");
    expect((await call(carol, "GET", "/api/battles/active")).body).toEqual({ battleId: null });
  });

  it("never creates a second battle for a player already in one", async () => {
    await call(alice, "POST", "/api/matchmaking/join");
    const matched = await call(bob, "POST", "/api/matchmaking/join");
    const carol = await createUser(pg, "carol");
    await call(carol, "POST", "/api/matchmaking/join");

    const again = await call(alice, "POST", "/api/matchmaking/join");
    expect(again.body).toEqual({ status: "matched", battleId: matched.body.battleId });
    const count = await pg.query<{ n: number }>("select count(*)::int as n from public.battles");
    expect(count.rows[0]!.n).toBe(1);
  });

  it("returns a generic error if the user has no profile", async () => {
    const ghost = "00000000-0000-4000-8000-000000000000";
    const res = await call(ghost, "POST", "/api/matchmaking/join");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL", message: "Something went wrong." } });
  });
});
