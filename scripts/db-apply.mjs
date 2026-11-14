/**
 * Applies supabase/migrations (in order, each in a transaction, each only once)
 * and then the seed to the database in SUPABASE_DB_URL.
 *
 *   node scripts/db-apply.mjs            apply pending migrations and the seed
 *   node scripts/db-apply.mjs --check    only test the connection
 *
 * Migration history is kept in supabase_migrations.schema_migrations, the same
 * table the Supabase CLI uses. The connection string is read from
 * apps/worker/.dev.vars (git-ignored) or the environment; it is never printed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const root = join(import.meta.dirname, "..");

function readDbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const text = readFileSync(join(root, "apps/worker/.dev.vars"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith("SUPABASE_DB_URL="));
  const value = line?.slice("SUPABASE_DB_URL=".length).trim();
  if (!value) throw new Error("SUPABASE_DB_URL is not set in apps/worker/.dev.vars");
  return value;
}

/** The direct host is IPv6-only on free projects; fall back to the regional pooler. */
function candidates(url) {
  const direct = new URL(url);
  const ref = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(direct.hostname)?.[1];
  const list = [{ label: "direct", url }];
  if (ref) {
    const regions = (process.env.SUPABASE_REGION ?? "ap-south-1,ap-southeast-1,us-east-1")
      .split(",")
      .map((r) => r.trim());
    for (const region of regions) {
      for (const prefix of ["aws-0", "aws-1"]) {
        const pooled = new URL(url);
        pooled.hostname = `${prefix}-${region}.pooler.supabase.com`;
        pooled.port = "5432";
        pooled.username = `postgres.${ref}`;
        list.push({ label: `pooler ${prefix}-${region}`, url: pooled.toString() });
      }
    }
  }
  return list;
}

async function connect() {
  const errors = [];
  for (const candidate of candidates(readDbUrl())) {
    const client = new pg.Client({
      connectionString: candidate.url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
      console.log(`Connected (${candidate.label}).`);
      return client;
    } catch (error) {
      errors.push(`${candidate.label}: ${error.code ?? ""} ${String(error.message).slice(0, 80)}`);
      await client.end().catch(() => {});
    }
  }
  throw new Error(`Could not connect to the database:\n  ${errors.join("\n  ")}`);
}

const client = await connect();
try {
  if (process.argv.includes("--check")) {
    const { rows } = await client.query("select current_user, version()");
    console.log(`User ${rows[0].current_user}; ${rows[0].version.split(" on ")[0]}`);
  } else {
    await client.query("create schema if not exists supabase_migrations");
    await client.query(`create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text)`);
    const done = new Set(
      (await client.query("select version from supabase_migrations.schema_migrations")).rows.map(
        (r) => r.version,
      ),
    );

    const dir = join(root, "supabase/migrations");
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
      if (done.has(version)) {
        console.log(`Already applied: ${file}`);
        continue;
      }
      const sql = readFileSync(join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)",
          [version, rest.join("_"), [sql]],
        );
        await client.query("commit");
        console.log(`Applied: ${file}`);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed and was rolled back: ${error.message}`, {
          cause: error,
        });
      }
    }

    await client.query("begin");
    await client.query(readFileSync(join(root, "supabase/seed/seed.sql"), "utf8"));
    await client.query("commit");
    const { rows } = await client.query(
      "select (select count(*) from public.problems) as problems, (select count(*) from public.problem_tests) as tests",
    );
    console.log(`Seeded: ${rows[0].problems} problems, ${rows[0].tests} hidden tests.`);
  }
} finally {
  await client.end();
}
