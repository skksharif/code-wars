import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect } from "vitest";
import { buildTestDatabase, TEST_SNAPSHOT_PATH } from "./global-setup.ts";
import { TEST_SALT } from "./test-salt.ts";

export { TEST_SALT };

/**
 * Fresh in-process Postgres with the Supabase stub, all migrations and the
 * test seed. Starts from the snapshot made once per run by global-setup.ts;
 * builds from scratch only if that snapshot is missing.
 */
export async function createDb(): Promise<PGlite> {
  if (!existsSync(TEST_SNAPSHOT_PATH)) return buildTestDatabase();
  return new PGlite({ loadDataDir: new Blob([readFileSync(TEST_SNAPSHOT_PATH)]) });
}

/** Removes all users and battle data; keeps problems. */
export async function resetState(db: PGlite): Promise<void> {
  await db.exec(`
    reset role;
    delete from public.custom_rooms;
    delete from public.submissions;
    delete from public.battle_players;
    delete from public.battles;
    delete from public.matchmaking_queue;
    delete from public.judge_usage;
    delete from auth.users;
  `);
}

export async function one<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<T>(sql, params);
  return result.rows[0] as T;
}

export async function all<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Signs a user up the way Supabase Auth does: insert into auth.users with metadata. */
export async function createUser(db: PGlite, username: string, rating = 1200): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, jsonb_build_object('username', $2::text)) returning id`,
    [`${username}@example.test`, username],
  );
  if (rating !== 1200) {
    await db.query("update public.profiles set rating = $1 where id = $2", [rating, row.id]);
  }
  return row.id;
}

export interface MatchResult {
  status: "queued" | "matched" | "timeout";
  battle_id?: string;
  waited_ms?: number;
}

export async function findMatch(db: PGlite, user: string): Promise<MatchResult> {
  return (await one<{ r: MatchResult }>(db, "select public.find_match($1) as r", [user])).r;
}

/** Matches two users and, by default, moves the battle past its get-ready phase. */
export async function makeBattle(
  db: PGlite,
  a: string,
  b: string,
  options: { started?: boolean } = {},
): Promise<string> {
  await findMatch(db, a);
  const result = await findMatch(db, b);
  if (result.status !== "matched" || !result.battle_id) {
    throw new Error(`Expected a match, got ${JSON.stringify(result)}`);
  }
  if (options.started ?? true) {
    await db.query(
      "update public.battles set starts_at = now() - interval '1 second' where id = $1",
      [result.battle_id],
    );
  }
  return result.battle_id;
}

export async function expireBattle(db: PGlite, battle: string): Promise<void> {
  await db.query(
    `update public.battles
     set starts_at = now() - interval '16 minutes', ends_at = now() - interval '1 second'
     where id = $1`,
    [battle],
  );
}

export interface BeginResult {
  submission_id: string;
  problem_id: string;
  total: number;
  time_limit_ms: number;
  memory_limit_kb: number;
}

export async function beginSubmission(
  db: PGlite,
  user: string,
  battle: string,
  options: { kind?: string; language?: string; code?: string; dailyLimit?: number | null } = {},
): Promise<BeginResult> {
  const row = await one<{ r: BeginResult }>(
    db,
    "select public.begin_submission($1, $2, $3, $4, $5, $6) as r",
    [
      user,
      battle,
      options.kind ?? "submit",
      options.language ?? "python",
      options.code ?? "print(1)",
      options.dailyLimit ?? null,
    ],
  );
  return row.r;
}

export async function completeSubmission(
  db: PGlite,
  submission: string,
  verdict: string,
  passed: number,
  executionsUsed: number | null = null,
): Promise<{ battle_finished: boolean }> {
  const row = await one<{ r: { battle_finished: boolean } }>(
    db,
    "select public.complete_submission($1, $2, $3, null, $4) as r",
    [submission, verdict, passed, executionsUsed],
  );
  return row.r;
}

/** Makes earlier submissions old enough that cooldowns no longer apply. */
export async function skipCooldown(db: PGlite): Promise<void> {
  await db.exec("update public.submissions set created_at = created_at - interval '11 seconds'");
}

/** One full judged Submit, ignoring cooldowns. */
export async function submit(
  db: PGlite,
  user: string,
  battle: string,
  verdict: string,
  passed: number,
): Promise<{ battle_finished: boolean }> {
  await skipCooldown(db);
  const begun = await beginSubmission(db, user, battle);
  return completeSubmission(db, begun.submission_id, verdict, passed);
}

/**
 * Ends the overtime that follows a first full solve: the other player gives
 * up (normal loss), or the overtime runs out.
 */
export async function endOvertime(
  db: PGlite,
  battle: string,
  how: "gave_up" | "timeout" = "gave_up",
): Promise<void> {
  if (how === "timeout") {
    await db.query(
      "update public.battles set overtime_ends_at = now() - interval '1 second' where id = $1",
      [battle],
    );
    await db.query("select public.finalize_battle_if_expired($1)", [battle]);
    return;
  }
  await db.query(
    `select public.forfeit_battle(bp.user_id, b.id)
     from public.battles b
     join public.battle_players bp on bp.battle_id = b.id and bp.user_id <> b.winner_id
     where b.id = $1`,
    [battle],
  );
}

export async function rating(db: PGlite, user: string): Promise<number> {
  return (
    await one<{ rating: number }>(db, "select rating from public.profiles where id = $1", [user])
  ).rating;
}

/** Runs queries as a browser client would: anon or an authenticated user, subject to RLS. */
export async function asClient<T>(
  db: PGlite,
  user: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`set role ${user ? "authenticated" : "anon"}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

export async function expectDbError(promise: Promise<unknown>, pattern: string | RegExp) {
  await expect(promise).rejects.toThrow(pattern);
}
