import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, createUser, resetState } from "../../../supabase/tests/helpers.ts";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import { createPgliteDb } from "./pglite-db";

const env: Env = { SUPABASE_URL: "http://unused.test", SUPABASE_SERVICE_ROLE_KEY: "unused" };

let pg: PGlite;
let app: ReturnType<typeof createApp>;
let host: string;
let guest: string;

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
  host = await createUser(pg, "host_player");
  guest = await createUser(pg, "guest_player");
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(user: string | null, method: string, path: string, body?: unknown) {
  const res = await app.request(
    path,
    {
      method,
      headers: {
        ...(user ? { Authorization: `Bearer ${user}` } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
  return { status: res.status, body: (await res.json()) as Json };
}

describe("custom rooms API", () => {
  it("runs the whole flow: create, look up, join, start, battle, rematch", async () => {
    const created = await call(host, "POST", "/api/rooms", { difficulty: "easy", minutes: 10 });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      status: "open",
      difficulty: "easy",
      minutes: 10,
      isHost: true,
      guest: null,
      host: { username: "host_player" },
    });
    const { id, code } = created.body as { id: string; code: string };

    const seen = await call(guest, "GET", `/api/rooms/code/${code.toLowerCase()}`);
    expect(seen.body).toMatchObject({ id, isHost: false, host: { username: "host_player" } });

    const joined = await call(guest, "POST", "/api/rooms/join", { code: ` ${code} ` });
    expect(joined.body.guest).toMatchObject({ username: "guest_player" });
    expect((await call(guest, "GET", "/api/rooms/current")).body.room.id).toBe(id);

    const early = await call(guest, "POST", `/api/rooms/${id}/start`);
    expect(early).toMatchObject({ status: 403, body: { error: { code: "NOT_HOST" } } });

    const started = await call(host, "POST", `/api/rooms/${id}/start`);
    expect(started.body.status).toBe("started");
    const battleId = started.body.battleId as string;
    expect((await call(guest, "GET", `/api/rooms/${id}`)).body.battleId).toBe(battleId);
    expect((await call(guest, "GET", "/api/battles/active")).body.battleId).toBe(battleId);

    const state = await call(guest, "GET", `/api/battles/${battleId}`);
    expect(state.body.battle).toMatchObject({ isRated: false, roomCode: code });

    await call(host, "POST", `/api/battles/${battleId}/forfeit`);
    const again = await call(guest, "POST", `/api/battles/${battleId}/rematch`);
    expect(again.body).toMatchObject({
      status: "open",
      isHost: true,
      difficulty: "easy",
      minutes: 10,
      guest: { username: "host_player" },
    });
  });

  it("explains problems with codes in plain words", async () => {
    const bad = await call(guest, "POST", "/api/rooms/join", { code: "12" });
    expect(bad).toMatchObject({
      status: 400,
      body: { error: { code: "INVALID_INPUT", message: "A room code has 6 letters and digits." } },
    });
    const missing = await call(guest, "GET", "/api/rooms/code/ABCDEF");
    expect(missing).toMatchObject({
      status: 404,
      body: { error: { code: "ROOM_NOT_FOUND", message: expect.stringContaining("No room") } },
    });

    const room = (await call(host, "POST", "/api/rooms", { difficulty: "any", minutes: 15 })).body;
    const own = await call(host, "POST", "/api/rooms/join", { code: room.code });
    expect(own).toMatchObject({ status: 409, body: { error: { code: "ROOM_OWN" } } });

    await pg.query("update public.custom_rooms set expires_at = now() - interval '1 second'");
    const expired = await call(guest, "POST", "/api/rooms/join", { code: room.code });
    expect(expired).toMatchObject({ status: 410, body: { error: { code: "ROOM_EXPIRED" } } });
  });

  it("validates settings and ids", async () => {
    for (const body of [
      { difficulty: "insane", minutes: 15 },
      { difficulty: "any", minutes: 20 },
      {},
    ]) {
      expect((await call(host, "POST", "/api/rooms", body)).status).toBe(400);
    }
    expect((await call(host, "GET", "/api/rooms/not-a-uuid")).status).toBe(400);
    expect((await call(host, "GET", "/api/rooms/current")).body).toEqual({ room: null });
  });

  it("keeps strangers out of a room", async () => {
    const stranger = await createUser(pg, "stranger");
    const room = (await call(host, "POST", "/api/rooms", { difficulty: "any", minutes: 15 })).body;
    expect((await call(stranger, "GET", `/api/rooms/${room.id}`)).status).toBe(403);
    expect((await call(stranger, "POST", `/api/rooms/${room.id}/start`)).status).toBe(403);
    expect((await call(stranger, "POST", `/api/rooms/${room.id}/leave`)).status).toBe(403);
  });

  it("lets the guest leave and the host close the room", async () => {
    const room = (await call(host, "POST", "/api/rooms", { difficulty: "any", minutes: 15 })).body;
    await call(guest, "POST", "/api/rooms/join", { code: room.code });
    await call(guest, "POST", `/api/rooms/${room.id}/leave`);
    expect((await call(host, "GET", `/api/rooms/${room.id}`)).body.guest).toBeNull();
    await call(host, "POST", `/api/rooms/${room.id}/leave`);
    expect((await call(host, "GET", "/api/rooms/current")).body.room).toBeNull();
  });

  it("requires sign-in", async () => {
    expect(
      (await call(null, "POST", "/api/rooms", { difficulty: "any", minutes: 15 })).status,
    ).toBe(401);
    expect((await call(null, "GET", "/api/rooms/code/ABCDEF")).status).toBe(401);
  });
});
