import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asClient,
  beginSubmission,
  createDb,
  createUser,
  expectDbError,
  expireBattle,
  findMatch,
  makeBattle,
  resetState,
  submit,
} from "../../../supabase/tests/helpers.ts";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import { runScheduledSweep } from "../src/routes/battles";
import { createPgliteDb } from "./pglite-db";

const env: Env = {
  SUPABASE_URL: "http://unused.test",
  SUPABASE_SERVICE_ROLE_KEY: "unused",
  JUDGE_PROVIDER: "mock",
};

let pg: PGlite;
let app: ReturnType<typeof createApp>;
let alice: string;
let bob: string;
let carol: string;
let battle: string;

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
  bob = await createUser(pg, "bob");
  carol = await createUser(pg, "carol");
  battle = await makeBattle(pg, alice, bob);
});

/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(user: string, method: string, path: string) {
  const res = await app.request(
    path,
    { method, headers: { Authorization: `Bearer ${user}` } },
    env,
  );
  return { status: res.status, body: (await res.json()) as any };
}
const getBattle = (user: string) => call(user, "GET", `/api/battles/${battle}`);
const ratings = async () =>
  (await pg.query<{ rating: number }>("select rating from public.profiles order by username")).rows
    .map((r) => r.rating)
    .slice(0, 2);

describe("GET /api/battles/:id", () => {
  it("returns the battle, both players and the problem to a participant", async () => {
    const { status, body } = await getBattle(alice);
    expect(status).toBe(200);
    expect(body.battle).toMatchObject({ id: battle, status: "active", winnerId: null });
    // The test helper moves the start into the past, so only check ordering here;
    // the exact 15-minute length is covered by the database tests.
    expect(new Date(body.battle.endsAt).getTime()).toBeGreaterThan(
      new Date(body.battle.startsAt).getTime(),
    );
    expect(Math.abs(new Date(body.serverTime).getTime() - Date.now())).toBeLessThan(60_000);

    expect(body.players).toHaveLength(2);
    expect(body.players[0]).toMatchObject({
      userId: alice,
      username: "alice",
      isYou: true,
      attempts: 0,
      bestPassed: 0,
      ratingBefore: 1200,
    });
    expect(body.players[1]).toMatchObject({ userId: bob, username: "bob", isYou: false });

    expect(body.totalTests).toBeGreaterThanOrEqual(5);
    expect(body.problem.title.length).toBeGreaterThan(0);
    expect(body.problem.samples).toHaveLength(2);
    expect(body.problem.timeLimitMs).toBe(2000);
  });

  it("never includes hidden tests or anyone's code", async () => {
    await submit(pg, bob, battle, "wrong_answer", 2);
    const text = JSON.stringify((await getBattle(alice)).body);
    expect(text).not.toContain("expected_output");
    expect(text).not.toContain("source_code");
    expect(text).not.toContain("print(1)");
  });

  it("withholds the problem until the battle starts", async () => {
    await pg.exec("update public.battles set starts_at = now() + interval '5 seconds'");
    const { body } = await getBattle(alice);
    expect(body.problem).toBeNull();
    expect(body.battle.status).toBe("active");
    expect(body.totalTests).toBeGreaterThanOrEqual(5);
  });

  it("shows the opponent's live progress", async () => {
    await submit(pg, bob, battle, "wrong_answer", 4);
    const { body } = await getBattle(alice);
    expect(body.players[1]).toMatchObject({ attempts: 1, bestPassed: 4, language: "python" });
  });

  it("is refused to outsiders and unknown battles", async () => {
    expect((await getBattle(carol)).status).toBe(403);
    const missing = await call(alice, "GET", "/api/battles/00000000-0000-4000-8000-000000000000");
    expect(missing.status).toBe(404);
    expect((await call(alice, "GET", "/api/battles/nonsense")).status).toBe(400);
  });

  it("resolves an expired battle instead of showing it as active", async () => {
    await submit(pg, alice, battle, "wrong_answer", 3);
    await expireBattle(pg, battle);
    const { body } = await getBattle(bob);
    expect(body.battle).toMatchObject({
      status: "finished",
      winnerId: alice,
      finishReason: "timeout_score",
    });
    expect(body.players.map((p: any) => p.result)).toEqual(["loss", "win"]);
    expect(body.players[0].ratingAfter).toBe(1184);
  });
});

describe("POST /api/battles/:id/forfeit", () => {
  it("gives the opponent the win", async () => {
    const res = await call(alice, "POST", `/api/battles/${battle}/forfeit`);
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect((await getBattle(alice)).body.battle).toMatchObject({
      status: "finished",
      winnerId: bob,
      finishReason: "forfeit",
    });
    expect(await ratings()).toEqual([1184, 1216]);
  });

  it("cannot be used by outsiders or twice", async () => {
    expect((await call(carol, "POST", `/api/battles/${battle}/forfeit`)).status).toBe(403);
    await call(alice, "POST", `/api/battles/${battle}/forfeit`);
    const again = await call(bob, "POST", `/api/battles/${battle}/forfeit`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("BATTLE_NOT_ACTIVE");
    expect(await ratings()).toEqual([1184, 1216]);
  });
});

describe("POST /api/battles/:id/finalize", () => {
  it("does nothing before the deadline, whatever the client claims", async () => {
    const res = await call(alice, "POST", `/api/battles/${battle}/finalize`);
    expect(res).toEqual({ status: 200, body: { finished: false } });
    expect((await getBattle(alice)).body.battle.status).toBe("active");
  });

  it("resolves the battle once after the deadline", async () => {
    await expireBattle(pg, battle);
    expect((await call(alice, "POST", `/api/battles/${battle}/finalize`)).body).toEqual({
      finished: true,
    });
    expect((await call(bob, "POST", `/api/battles/${battle}/finalize`)).body).toEqual({
      finished: false,
    });
    expect((await getBattle(alice)).body.battle.finishReason).toBe("timeout_draw");
    expect(await ratings()).toEqual([1200, 1200]);
  });

  it("is refused to outsiders", async () => {
    await expireBattle(pg, battle);
    expect((await call(carol, "POST", `/api/battles/${battle}/finalize`)).status).toBe(403);
    expect((await getBattle(alice)).body.battle.status).toBe("finished");
  });
});

describe("scheduled sweep", () => {
  it("resolves abandoned expired battles and clears stuck rows", async () => {
    const dave = await createUser(pg, "dave");
    const other = await makeBattle(pg, carol, dave);
    const erin = await createUser(pg, "erin");
    await findMatch(pg, erin);
    await beginSubmission(pg, carol, other);
    await expireBattle(pg, battle);
    await pg.exec(`
      update public.submissions set created_at = now() - interval '91 seconds';
      update public.matchmaking_queue set heartbeat_at = now() - interval '16 seconds';
    `);

    expect(await runScheduledSweep(createPgliteDb(pg))).toEqual({ finalized: 1 });

    const statuses = await pg.query<{ id: string; status: string }>(
      "select id, status from public.battles",
    );
    expect(statuses.rows.find((b) => b.id === battle)!.status).toBe("finished");
    expect(statuses.rows.find((b) => b.id === other)!.status).toBe("active");
    const stuck = await pg.query<{ status: string }>("select status from public.submissions");
    expect(stuck.rows).toEqual([{ status: "error" }]);
    const queue = await pg.query("select 1 from public.matchmaking_queue");
    expect(queue.rows).toHaveLength(0);
  });
});

describe("new database functions", () => {
  it("cannot be called directly by clients", async () => {
    await asClient(pg, alice, async () => {
      await expectDbError(
        pg.query("select public.get_battle_state($1, $2)", [bob, battle]),
        /permission denied/,
      );
      await expectDbError(
        pg.query("select public.request_finalize($1, $2)", [alice, battle]),
        /permission denied/,
      );
    });
  });
});
