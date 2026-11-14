/**
 * Concurrency check against REAL services (needs the Worker running locally
 * with the mock judge). Fires simultaneous requests to prove that:
 *   - six players joining at once form exactly three battles, one each;
 *   - two players solving at the same instant produce exactly one winner
 *     and one rating update.
 * Temporary accounts are removed afterwards. No secret is printed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const root = join(import.meta.dirname, "..");
const parseEnv = (file) =>
  Object.fromEntries(
    readFileSync(join(root, file), "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Za-z_0-9]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
const web = parseEnv("apps/web/.env.local");
const worker = parseEnv("apps/worker/.dev.vars");
const API = web.VITE_API_BASE_URL;
const admin = createClient(web.VITE_SUPABASE_URL, worker.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const stamp = Date.now().toString(36);
const password = `Race-${stamp}-${Math.random().toString(36).slice(2)}`;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeUser(i) {
  const username = `e2e_r${i}_${stamp}`.slice(0, 20);
  const email = `${username}@example.com`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (created.error) throw new Error(created.error.message);
  const client = createClient(web.VITE_SUPABASE_URL, web.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(signedIn.error.message);
  return { id: created.data.user.id, token: signedIn.data.session.access_token };
}
const post = async (user, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${user.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const db = new pg.Client({
  connectionString: worker.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
const users = [];
try {
  await db.connect();
  for (let i = 0; i < 6; i++) users.push(await makeUser(i));
  const ids = users.map((u) => u.id);

  // Everyone presses Find Battle at the same moment, twice.
  await Promise.all(users.map((u) => post(u, "/api/matchmaking/join")));
  const second = await Promise.all(users.map((u) => post(u, "/api/matchmaking/join")));
  const battles = new Set(second.map((r) => r.body?.battleId).filter(Boolean));
  check(
    "All six players end up matched",
    second.every((r) => r.body?.status === "matched"),
  );
  check("Exactly three battles were created", battles.size === 3, `${battles.size} battles`);
  const perUser = await db.query(
    "select user_id, count(*)::int as n from public.battle_players where user_id = any($1) and is_active group by user_id",
    [ids],
  );
  check(
    "Every player is in exactly one active battle",
    perUser.rows.length === 6 && perUser.rows.every((r) => r.n === 1),
  );
  const queue = await db.query(
    "select count(*)::int as n from public.matchmaking_queue where user_id = any($1)",
    [ids],
  );
  check("Nobody is left in the queue", queue.rows[0].n === 0);

  // Skip the get-ready countdown for one battle, then both players solve at once.
  const battleId = second[0].body.battleId;
  await db.query(
    "update public.battles set starts_at = now() - interval '1 second' where id = $1",
    [battleId],
  );
  const pair = users.filter((_, i) => second[i].body.battleId === battleId);
  const results = await Promise.all(
    pair.map((u) =>
      post(u, `/api/battles/${battleId}/submit`, { language: "python", code: "print('solved')" }),
    ),
  );
  const finishers = results.filter((r) => r.body?.battleFinished === true).length;
  check(
    "Exactly one simultaneous solve ended the battle",
    finishers === 1,
    `${finishers} finishers`,
  );
  const ratings = await db.query(
    "select rating from public.profiles where id = any($1) order by rating",
    [pair.map((u) => u.id)],
  );
  check(
    "Ratings were applied exactly once",
    ratings.rows.map((r) => r.rating).join(",") === "1184,1216",
    ratings.rows.map((r) => r.rating).join(","),
  );

  // Same player double-clicks Submit in another battle.
  const otherId = [...battles].find((b) => b !== battleId);
  await db.query(
    "update public.battles set starts_at = now() - interval '1 second' where id = $1",
    [otherId],
  );
  const clicker = users.find((_, i) => second[i].body.battleId === otherId);
  const double = await Promise.all(
    [1, 2].map(() =>
      post(clicker, `/api/battles/${otherId}/submit`, {
        language: "python",
        code: "# MOCK:PASS=1",
      }),
    ),
  );
  const statuses = double
    .map((r) => r.status)
    .sort()
    .join(",");
  check(
    "A double-clicked Submit is judged only once",
    statuses === "200,409" || statuses === "200,429",
    statuses,
  );
  const attempts = await db.query(
    "select attempts from public.battle_players where battle_id = $1 and user_id = $2",
    [otherId, clicker.id],
  );
  check("Only one attempt was recorded", attempts.rows[0].attempts === 1);

  // Cron sweep: expire the remaining battles and trigger the scheduled handler.
  await db.query(
    "update public.battles set starts_at = now() - interval '16 minutes', ends_at = now() - interval '1 second' where id = any($1) and status = 'active'",
    [[...battles]],
  );
  const cron = await fetch(`${API}/cdn-cgi/handler/scheduled`).catch(() => null);
  await sleep(4000);
  const left = await db.query(
    "select count(*)::int as n from public.battles where id = any($1) and status = 'active'",
    [[...battles]],
  );
  check(
    "Cron sweep resolved the expired battles",
    left.rows[0].n === 0,
    `trigger ${cron?.status}; ${left.rows[0].n} still active`,
  );
} catch (error) {
  failures++;
  console.log(`ERROR ${error.message}`);
} finally {
  for (const user of users) await admin.auth.admin.deleteUser(user.id).catch(() => {});
  const removed = await db
    .query(
      "delete from public.battles b where not exists (select 1 from public.battle_players p where p.battle_id = b.id)",
    )
    .catch(() => ({ rowCount: "?" }));
  console.log(`Cleanup: removed ${removed.rowCount} battle(s).`);
  await db.end().catch(() => {});
}
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
