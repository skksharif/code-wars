import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, createUser, makeBattle, resetState } from "../../../supabase/tests/helpers.ts";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import { createPgliteDb } from "./pglite-db";

const env: Env = { SUPABASE_URL: "http://unused.test", SUPABASE_SERVICE_ROLE_KEY: "unused" };

let pg: PGlite;
let app: ReturnType<typeof createApp>;
let ana: string;
let ben: string;

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
  ana = await createUser(pg, "ana_player");
  ben = await createUser(pg, "ben_player");
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

describe("friends and challenges API", () => {
  it("runs the whole flow: request, accept, challenge, accept, battle", async () => {
    expect(
      (await call(ana, "POST", "/api/friends/request", { username: "Ben_Player" })).body,
    ).toEqual({ status: "outgoing", userId: ben });
    expect((await call(ben, "GET", "/api/notifications")).body.friendRequests).toBe(1);
    expect((await call(ben, "GET", "/api/friends/status/ana_player")).body.status).toBe("incoming");

    await call(ben, "POST", "/api/friends/respond", { userId: ana, accept: true });
    const list = (await call(ana, "GET", "/api/friends")).body;
    expect(list.friends).toEqual([
      expect.objectContaining({
        userId: ben,
        username: "ben_player",
        inBattle: false,
        headToHead: { wins: 0, losses: 0, draws: 0 },
      }),
    ]);

    const sent = await call(ana, "POST", "/api/challenges", {
      userId: ben,
      difficulty: "easy",
      minutes: 10,
    });
    expect(sent.body).toMatchObject({
      status: "pending",
      isChallenger: true,
      difficulty: "easy",
      minutes: 10,
      challenged: { username: "ben_player" },
    });

    const inbox = (await call(ben, "GET", "/api/notifications")).body;
    expect(inbox.incomingChallenges).toEqual([
      expect.objectContaining({
        id: sent.body.id,
        challenger: expect.objectContaining({ userId: ana }),
      }),
    ]);

    const accepted = await call(ben, "POST", `/api/challenges/${sent.body.id}/respond`, {
      accept: true,
    });
    expect(accepted.body.status).toBe("accepted");
    const battleId = accepted.body.battleId as string;
    expect((await call(ana, "GET", "/api/notifications")).body.outgoingChallenge).toMatchObject({
      status: "accepted",
      battleId,
    });
    const state = await call(ana, "GET", `/api/battles/${battleId}`);
    expect(state.body.battle.isRated).toBe(false);
  });

  it("refuses to challenge a busy friend with a clear message", async () => {
    await call(ana, "POST", "/api/friends/request", { username: "ben_player" });
    await call(ben, "POST", "/api/friends/respond", { userId: ana, accept: true });
    const cat = await createUser(pg, "cat_player");
    await makeBattle(pg, ben, cat);
    expect((await call(ana, "GET", "/api/friends")).body.friends[0].inBattle).toBe(true);
    const busy = await call(ana, "POST", "/api/challenges", {
      userId: ben,
      difficulty: "any",
      minutes: 15,
    });
    expect(busy).toMatchObject({
      status: 409,
      body: { error: { code: "FRIEND_BUSY", message: expect.stringContaining("in a battle") } },
    });
  });

  it("explains bad requests", async () => {
    expect(
      (await call(ana, "POST", "/api/friends/request", { username: "ghost_user" })).body,
    ).toMatchObject({
      error: { code: "PLAYER_NOT_FOUND", message: "No player with that username." },
    });
    expect((await call(ana, "POST", "/api/friends/request", { username: "a b" })).status).toBe(400);
    expect(
      (await call(ana, "POST", "/api/challenges", { userId: ben, difficulty: "any", minutes: 15 }))
        .body.error.code,
    ).toBe("NOT_FRIENDS");
    expect(
      (await call(ana, "POST", "/api/challenges/not-a-uuid/respond", { accept: true })).status,
    ).toBe(400);
  });

  it("lets players decline, withdraw and unfriend", async () => {
    await call(ana, "POST", "/api/friends/request", { username: "ben_player" });
    await call(ben, "POST", "/api/friends/respond", { userId: ana, accept: false });
    const again = await call(ana, "POST", "/api/friends/request", { username: "ben_player" });
    expect(again.body.error.code).toBe("REQUEST_DECLINED");

    await call(ben, "POST", "/api/friends/request", { username: "ana_player" });
    await call(ben, "POST", "/api/friends/remove", { userId: ana });
    expect((await call(ana, "GET", "/api/friends")).body.incoming).toEqual([]);
  });

  it("requires sign-in", async () => {
    expect((await call(null, "GET", "/api/friends")).status).toBe(401);
    expect((await call(null, "GET", "/api/notifications")).status).toBe(401);
  });
});
