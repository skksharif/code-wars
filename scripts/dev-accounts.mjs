/**
 * Development helper for trying the app in a browser.
 *
 *   node scripts/dev-accounts.mjs create     make two confirmed test accounts and print how to log in
 *   node scripts/dev-accounts.mjs bot        log in as the second account, join matchmaking,
 *                                            and play: one wrong submission after the start
 *   node scripts/dev-accounts.mjs remove     delete both accounts and their battles
 *
 * The accounts use a fixed, throwaway password that only exists for local testing.
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
const admin = createClient(web.VITE_SUPABASE_URL, worker.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const PASSWORD = "local-test-only-1";
const ACCOUNTS = [
  { username: "dev_player", email: "dev_player@example.com" },
  { username: "dev_rival", email: "dev_rival@example.com" },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function remove() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const user of data?.users ?? []) {
    if (ACCOUNTS.some((a) => a.email === user.email)) await admin.auth.admin.deleteUser(user.id);
  }
  const db = new pg.Client({
    connectionString: worker.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  await db.query(
    "delete from public.battles b where not exists (select 1 from public.battle_players p where p.battle_id = b.id)",
  );
  await db.end();
  console.log("Removed the test accounts.");
}

const command = process.argv[2];
if (command === "create") {
  await remove();
  for (const account of ACCOUNTS) {
    const { error } = await admin.auth.admin.createUser({
      email: account.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { username: account.username },
    });
    if (error) throw new Error(error.message);
  }
  console.log(`Log in at the site as ${ACCOUNTS[0].email} with password ${PASSWORD}`);
} else if (command === "bot") {
  const client = createClient(web.VITE_SUPABASE_URL, web.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({
    email: ACCOUNTS[1].email,
    password: PASSWORD,
  });
  if (signedIn.error) throw new Error(signedIn.error.message);
  const token = signedIn.data.session.access_token;
  const call = async (method, path, body) => {
    const res = await fetch(`${web.VITE_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json().catch(() => null);
  };

  let battleId = null;
  for (let i = 0; i < 11 && !battleId; i++) {
    const result = await call("POST", "/api/matchmaking/join");
    console.log(`bot: ${result?.status}`);
    if (result?.status === "matched") battleId = result.battleId;
    else if (result?.status === "timeout") break;
    else await sleep(5000);
  }
  if (!battleId) {
    console.log("bot: no opponent appeared");
    process.exit(0);
  }
  const state = await call("GET", `/api/battles/${battleId}`);
  const wait = Date.parse(state.battle.startsAt) - Date.parse(state.serverTime);
  await sleep(Math.max(0, wait) + 6000);
  const submitted = await call("POST", `/api/battles/${battleId}/submit`, {
    language: "cpp",
    code: "// MOCK:PASS=3",
  });
  console.log(`bot: submitted, ${submitted?.verdict} ${submitted?.passed}/${submitted?.total}`);
} else if (command === "remove") {
  await remove();
} else {
  console.log("Usage: node scripts/dev-accounts.mjs create | bot | remove");
}
