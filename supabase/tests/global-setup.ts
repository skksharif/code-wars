/**
 * Runs once before all tests. Applying the migrations and loading the seed for
 * 50 problems takes several seconds, so it is done once here and saved as a
 * database snapshot. Each database test file then starts from a copy of that
 * snapshot instead of rebuilding everything in parallel.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { buildSeedSql } from "../seed/generate.ts";
import { TEST_SALT } from "./test-salt.ts";

const GENERATED = join(import.meta.dirname, "..", "seed", ".generated");
export const TEST_SNAPSHOT_PATH = join(GENERATED, "test-db.tar.gz");

/** A fresh database with the Supabase stub, every migration and the test seed. */
export async function buildTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, "supabase-stub.sql"), "utf8"));
  const migrations = join(import.meta.dirname, "..", "migrations");
  for (const name of readdirSync(migrations)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(migrations, name), "utf8"));
  }
  await db.exec(buildSeedSql(TEST_SALT));
  return db;
}

export default async function setup(): Promise<void> {
  const db = await buildTestDatabase();
  const snapshot = await db.dumpDataDir("gzip");
  await db.close();
  mkdirSync(dirname(TEST_SNAPSHOT_PATH), { recursive: true });
  writeFileSync(TEST_SNAPSHOT_PATH, Buffer.from(await snapshot.arrayBuffer()));
}
