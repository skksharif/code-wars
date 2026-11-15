import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asClient,
  createDb,
  createUser,
  expireBattle,
  makeBattle,
  one,
  resetState,
  submit,
} from "./helpers.ts";

interface Profile {
  username: string;
  rating: number;
  rank: number;
  wins: number;
  losses: number;
  draws: number;
  peak_rating: number;
  streak: { result: string; count: number } | null;
  rating_history: number[];
  languages: Record<string, number>;
  wins_by_difficulty: { easy: number; medium: number; hard: number };
  recent_battles: {
    battle_id: string;
    result: string;
    rating_before: number;
    rating_after: number;
    opponent: string;
  }[];
}

let db: PGlite;
let a: string;
let b: string;

beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await resetState(db);
  a = await createUser(db, "alice");
  b = await createUser(db, "bob");
});

const profile = async (username: string) =>
  (await one<{ p: Profile | null }>(db, "select public.get_public_profile($1) as p", [username])).p;

/** A finished battle: `winner` fully solves it (null = timed-out draw). */
async function playBattle(winner: string | null) {
  const battle = await makeBattle(db, a, b);
  if (winner) {
    await submit(db, winner, battle, "accepted", (await totalTests(battle)) as number);
  } else {
    await expireBattle(db, battle);
    await db.query("select public.finalize_battle_if_expired($1)", [battle]);
  }
  // Keep finish times strictly ordered.
  await db.query(
    "update public.battles set finished_at = now() + (select count(*) from public.battles) * interval '1 second' where id = $1",
    [battle],
  );
  return battle;
}

async function totalTests(battle: string) {
  return (
    await one<{ n: number }>(
      db,
      "select count(*)::int as n from public.problem_tests t join public.battles x on x.problem_id = t.problem_id where x.id = $1",
      [battle],
    )
  ).n;
}

describe("public profile", () => {
  it("shows a new player with no battles", async () => {
    const p = await profile("alice");
    expect(p).toMatchObject({
      username: "alice",
      rating: 1200,
      rank: 1,
      wins: 0,
      losses: 0,
      draws: 0,
      peak_rating: 1200,
      streak: null,
      rating_history: [],
      languages: {},
      wins_by_difficulty: { easy: 0, medium: 0, hard: 0 },
      recent_battles: [],
    });
  });

  it("finds players regardless of letter case and returns null for unknown names", async () => {
    expect((await profile("ALICE"))?.username).toBe("alice");
    expect(await profile("nobody_here")).toBeNull();
  });

  it("summarises battles: record, streak, peak, history, languages and difficulty", async () => {
    await playBattle(a);
    await playBattle(b);
    await playBattle(a);
    await playBattle(a);
    await playBattle(null);

    const p = (await profile("alice"))!;
    expect(p).toMatchObject({ wins: 3, losses: 1, draws: 1, rank: 1 });
    expect(p.streak).toEqual({ result: "draw", count: 1 });
    expect(p.rating_history).toHaveLength(6);
    expect(p.rating_history[0]).toBe(1200);
    expect(p.rating_history[p.rating_history.length - 1]).toBe(p.rating);
    expect(p.peak_rating).toBe(Math.max(...p.rating_history));
    expect(p.languages).toEqual({ python: 3 });
    expect(p.wins_by_difficulty.easy).toBe(3);

    expect(p.recent_battles).toHaveLength(5);
    expect(p.recent_battles[0]).toMatchObject({ result: "draw", opponent: "bob" });
    expect(p.recent_battles[4]).toMatchObject({ result: "win", rating_before: 1200 });

    const bob = (await profile("bob"))!;
    expect(bob.streak).toEqual({ result: "draw", count: 1 });
    expect(bob.rank).toBe(2);
  });

  it("counts a winning streak", async () => {
    await playBattle(b);
    await playBattle(a);
    await playBattle(a);
    expect((await profile("alice"))!.streak).toEqual({ result: "win", count: 2 });
  });

  it("leaves out battles that are still running", async () => {
    const battle = await makeBattle(db, a, b);
    await submit(db, a, battle, "wrong_answer", 1);
    const p = (await profile("alice"))!;
    expect(p.recent_battles).toEqual([]);
    expect(p.languages).toEqual({});
  });

  it("keeps only the 10 most recent battles", async () => {
    for (let i = 0; i < 12; i++) await playBattle(i % 2 === 0 ? a : b);
    const p = (await profile("alice"))!;
    expect(p.recent_battles).toHaveLength(10);
    expect(p.rating_history).toHaveLength(13);
  });

  it("is readable by visitors who are not logged in, and by other players", async () => {
    await playBattle(a);
    const outsider = await createUser(db, "carol");
    await asClient(db, null, async () => expect((await profile("alice"))?.wins).toBe(1));
    await asClient(db, outsider, async () => expect((await profile("alice"))?.wins).toBe(1));
  });

  it("never reveals email addresses, code or problem details", async () => {
    await playBattle(a);
    const text = await asClient(db, null, async () => JSON.stringify(await profile("alice")));
    expect(text).not.toContain("@example.test");
    expect(text).not.toContain("print(1)");
    expect(text).not.toMatch(/problem|statement|expected_output|source_code|email/);
  });
});
