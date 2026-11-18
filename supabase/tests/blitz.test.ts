import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  all,
  asClient,
  beginSubmission,
  completeSubmission,
  createDb,
  createUser,
  endOvertime,
  expectDbError,
  expireBattle,
  findMatch,
  one,
  resetState,
  skipCooldown,
} from "./helpers.ts";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());

interface Ratings {
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  blitz_rating: number;
  blitz_wins: number;
  blitz_losses: number;
  blitz_draws: number;
}
const ratings = (user: string) =>
  one<Ratings>(
    db,
    `select rating, wins, losses, draws, blitz_rating, blitz_wins, blitz_losses, blitz_draws
     from public.profiles where id = $1`,
    [user],
  );

const blitzMatch = (user: string) =>
  one<{ r: { status: string; battle_id?: string } }>(
    db,
    "select public.find_match($1, 'blitz') as r",
    [user],
  ).then((row) => row.r);

async function startBlitz(a: string, b: string): Promise<string> {
  await blitzMatch(a);
  const matched = await blitzMatch(b);
  if (matched.status !== "matched" || !matched.battle_id) {
    throw new Error(`Expected a Blitz match, got ${JSON.stringify(matched)}`);
  }
  await db.query(
    "update public.battles set starts_at = now() - interval '1 second' where id = $1",
    [matched.battle_id],
  );
  return matched.battle_id;
}

async function solve(user: string, battle: string) {
  await skipCooldown(db);
  const begun = await beginSubmission(db, user, battle);
  return completeSubmission(db, begun.submission_id, "accepted", begun.total);
}

let ana: string;
let ben: string;
beforeEach(async () => {
  await resetState(db);
  ana = await createUser(db, "ana_blitz", 1500);
  ben = await createUser(db, "ben_blitz", 1300);
  // Blitz ratings are separate from Ranked ones.
  await db.query("update public.profiles set blitz_rating = 1180 where id = $1", [ana]);
  await db.query("update public.profiles set blitz_rating = 1250 where id = $1", [ben]);
});

describe("blitz matchmaking", () => {
  it("has its own queue: Blitz players never meet Ranked players", async () => {
    await blitzMatch(ana);
    expect((await findMatch(db, ben)).status).toBe("queued");
    // ana is still waiting in Blitz, ben in Ranked.
    const queue = await all<{ user_id: string; mode: string }>(
      db,
      "select user_id, mode from public.matchmaking_queue order by mode",
    );
    expect(queue).toEqual([
      { user_id: ana, mode: "blitz" },
      { user_id: ben, mode: "standard" },
    ]);
  });

  it("makes a 5-minute battle on an Easy problem, using Blitz ratings", async () => {
    // Ranked ratings 1500 and 1300 would pick a Medium problem; Blitz is always Easy.
    const battle = await startBlitz(ana, ben);
    const row = await one<{ mode: string; minutes: number; difficulty: string }>(
      db,
      `select b.mode, round(extract(epoch from (b.ends_at - b.starts_at)) / 60)::int as minutes, p.difficulty
       from public.battles b join public.problems p on p.id = b.problem_id where b.id = $1`,
      [battle],
    );
    expect(row).toEqual({ mode: "blitz", minutes: 5, difficulty: "easy" });
    const before = await all<{ rating_before: number }>(
      db,
      "select rating_before from public.battle_players where battle_id = $1 order by rating_before",
      [battle],
    );
    expect(before.map((r) => r.rating_before)).toEqual([1180, 1250]);
  });

  it("rejects an unknown mode", async () => {
    await expectDbError(db.query("select public.find_match($1, 'bullet')", [ana]), "INVALID_INPUT");
  });

  it("switching from a Blitz search to a Ranked one moves the player to that queue", async () => {
    await blitzMatch(ana);
    await findMatch(db, ana);
    const row = await one<{ mode: string }>(
      db,
      "select mode from public.matchmaking_queue where user_id = $1",
      [ana],
    );
    expect(row.mode).toBe("standard");
  });
});

describe("blitz ratings", () => {
  it("a win moves Blitz ratings and records only; Ranked stays as it was", async () => {
    const battle = await startBlitz(ana, ben);
    await solve(ana, battle);
    // Overtime for Blitz is 1 minute.
    const overtime = await one<{ seconds: number }>(
      db,
      "select round(extract(epoch from (overtime_ends_at - first_solved_at))) as seconds from public.battles where id = $1",
      [battle],
    );
    expect(Number(overtime.seconds)).toBe(60);
    await endOvertime(db, battle, "gave_up");

    const a = await ratings(ana);
    const b = await ratings(ben);
    // 1180 vs 1250 at K = 32: the underdog gains 19.
    expect([a.blitz_rating, a.blitz_wins, a.blitz_losses]).toEqual([1199, 1, 0]);
    expect([b.blitz_rating, b.blitz_wins, b.blitz_losses]).toEqual([1231, 0, 1]);
    expect([a.rating, a.wins, a.losses, b.rating, b.wins, b.losses]).toEqual([
      1500, 0, 0, 1300, 0, 0,
    ]);
    const players = await all<{ rating_before: number; rating_after: number }>(
      db,
      "select rating_before, rating_after from public.battle_players where battle_id = $1 order by rating_before",
      [battle],
    );
    expect(players).toEqual([
      { rating_before: 1180, rating_after: 1199 },
      { rating_before: 1250, rating_after: 1231 },
    ]);
  });

  it("solving in Blitz overtime halves the Blitz loss", async () => {
    const battle = await startBlitz(ana, ben);
    await solve(ana, battle);
    await solve(ben, battle);
    // Full loss would be 19; halved toward zero: 9.
    expect((await ratings(ben)).blitz_rating).toBe(1241);
    expect((await ratings(ben)).rating).toBe(1300);
  });

  it("a draw counts as a Blitz draw", async () => {
    const battle = await startBlitz(ana, ben);
    await expireBattle(db, battle);
    await db.query("select public.finalize_battle_if_expired($1)", [battle]);
    const a = await ratings(ana);
    expect([a.blitz_draws, a.draws]).toEqual([1, 0]);
  });

  it("a rematch of a Blitz battle is Blitz too", async () => {
    const battle = await startBlitz(ana, ben);
    await solve(ana, battle);
    await endOvertime(db, battle, "gave_up");
    const again = await one<{ id: string }>(db, "select public.start_rematch($1) as id", [battle]);
    const row = await one<{ mode: string; minutes: number }>(
      db,
      "select mode, round(extract(epoch from (ends_at - starts_at)) / 60)::int as minutes from public.battles where id = $1",
      [again.id],
    );
    expect(row).toEqual({ mode: "blitz", minutes: 5 });
    const before = await all<{ rating_before: number }>(
      db,
      "select rating_before from public.battle_players where battle_id = $1 order by rating_before",
      [again.id],
    );
    expect(before.map((r) => r.rating_before)).toEqual([1199, 1231]);
  });
});

describe("blitz pace", () => {
  it("submits wait 5 seconds instead of 10", async () => {
    const battle = await startBlitz(ana, ben);
    const first = await beginSubmission(db, ana, battle);
    await completeSubmission(db, first.submission_id, "wrong_answer", 0);
    await expectDbError(beginSubmission(db, ana, battle), "COOLDOWN");
    await db.query(
      "update public.submissions set created_at = created_at - interval '6 seconds' where battle_id = $1",
      [battle],
    );
    await expect(beginSubmission(db, ana, battle)).resolves.toMatchObject({
      total: expect.any(Number),
    });
  });
});

describe("blitz on profiles and rankings", () => {
  it("public profiles keep Ranked stats Ranked-only and show Blitz numbers", async () => {
    const battle = await startBlitz(ana, ben);
    await solve(ana, battle);
    await endOvertime(db, battle, "gave_up");
    const profile = (
      await one<{ p: Record<string, unknown> }>(
        db,
        "select public.get_public_profile('ana_blitz') as p",
      )
    ).p;
    expect(profile).toMatchObject({
      rating: 1500,
      wins: 0,
      blitz_rating: 1199,
      blitz_wins: 1,
      blitz_losses: 0,
      blitz_draws: 0,
    });
    // The Blitz battle is not in the Ranked rating history or recent battles
    // (A Blitz game would have added two points here.)
    expect(profile.rating_history).toEqual([]);
    expect(profile.recent_battles).toEqual([]);
  });

  it("anyone can read the Blitz rankings", async () => {
    const rows = await asClient(db, null, () =>
      all<{ username: string; rating: number; rank: number }>(
        db,
        "select username, rating, rank from public.blitz_leaderboard order by rating desc",
      ),
    );
    expect(rows.map((r) => [r.username, r.rating, Number(r.rank)])).toEqual([
      ["ben_blitz", 1250, 1],
      ["ana_blitz", 1180, 2],
    ]);
  });

  it("battle state says the battle is Blitz", async () => {
    const battle = await startBlitz(ana, ben);
    const state = (
      await one<{ s: { battle: { mode: string } } }>(
        db,
        "select public.get_battle_state($1, $2) as s",
        [ana, battle],
      )
    ).s;
    expect(state.battle.mode).toBe("blitz");
  });
});
