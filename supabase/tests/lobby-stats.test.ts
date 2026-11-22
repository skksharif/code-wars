import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asClient, createDb, createUser, makeBattle, one, resetState } from "./helpers.ts";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());
beforeEach(() => resetState(db));

const stats = () =>
  one<{ s: { players: number; battles_today: number } }>(
    db,
    "select public.get_lobby_stats() as s",
  ).then((r) => r.s);

describe("get_lobby_stats", () => {
  it("counts players and today's battles, and visitors may read it", async () => {
    const a = await createUser(db, "lobby_a");
    const b = await createUser(db, "lobby_b");
    const c = await createUser(db, "lobby_c");
    const d = await createUser(db, "lobby_d");
    await makeBattle(db, a, b);
    // An old battle does not count as today.
    await db.query("update public.battles set created_at = now() - interval '2 days'");
    await makeBattle(db, c, d);
    const seen = await asClient(db, null, stats);
    expect(seen).toEqual({ players: 4, battles_today: 1 });
  });

  it("is zero on an empty site", async () => {
    expect(await asClient(db, null, stats)).toEqual({ players: 0, battles_today: 0 });
  });
});
