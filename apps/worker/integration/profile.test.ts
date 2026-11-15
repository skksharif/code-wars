import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, createUser, one, resetState } from "../../../supabase/tests/helpers.ts";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import { createPgliteDb } from "./pglite-db";

const env: Env = { SUPABASE_URL: "http://unused.test", SUPABASE_SERVICE_ROLE_KEY: "unused" };

let pg: PGlite;
let app: ReturnType<typeof createApp>;
let alice: string;

beforeAll(async () => {
  pg = await createDb();
  app = createApp({
    verifyToken: async (token) => (/^[0-9a-f-]{36}$/.test(token) ? token : null),
    createDb: () => createPgliteDb(pg),
  });
});
afterAll(() => pg.close());
beforeEach(async () => {
  await resetState(pg);
  alice = await createUser(pg, "alice");
});

async function setAvatar(user: string | null, body: unknown) {
  const res = await app.request(
    "/api/profile/avatar",
    {
      method: "POST",
      headers: {
        ...(user ? { Authorization: `Bearer ${user}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const avatarOf = async (user: string) =>
  (await one<{ avatar: string }>(pg, "select avatar from public.profiles where id = $1", [user]))
    .avatar;

describe("POST /api/profile/avatar", () => {
  it("changes the signed-in player's avatar", async () => {
    expect(await setAvatar(alice, { avatar: "nova" })).toEqual({
      status: 200,
      body: { avatar: "nova" },
    });
    expect(await avatarOf(alice)).toBe("nova");
  });

  it("only changes the caller's own avatar", async () => {
    const bob = await createUser(pg, "bob");
    const before = await avatarOf(bob);
    await setAvatar(alice, { avatar: "echo", userId: bob });
    expect(await avatarOf(bob)).toBe(before);
  });

  it("rejects unknown avatars and bad bodies", async () => {
    for (const body of [{ avatar: "dragon" }, { avatar: 3 }, {}, null]) {
      const res = await setAvatar(alice, body);
      expect(res.status).toBe(400);
    }
  });

  it("requires sign-in", async () => {
    expect((await setAvatar(null, { avatar: "nova" })).status).toBe(401);
  });
});
