/**
 * End-to-end check against REAL services: Supabase (Auth, database, RLS,
 * Realtime) and a locally running Worker. Plays one battle with two temporary
 * accounts, then removes them.
 *
 *   1. In apps/worker:  npx wrangler dev        (reads .dev.vars)
 *   2. In the repo root: node scripts/e2e-battle.mjs
 *
 * Works with either judge. With the mock judge the code markers decide the
 * outcome; with Judge0 real Python solutions are sent (uses about 15 executions).
 * No secret is ever printed.
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
const API = process.env.API_BASE_URL ?? web.VITE_API_BASE_URL;
const SUPABASE_URL = web.VITE_SUPABASE_URL;
const PUBLIC_KEY = web.VITE_SUPABASE_ANON_KEY;
const SECRET_KEY = worker.SUPABASE_SERVICE_ROLE_KEY;
const REAL_JUDGE = process.argv.includes("--judge0");

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });
const stamp = Date.now().toString(36);
const password = `E2e-${stamp}-${Math.random().toString(36).slice(2)}`;

async function makeUser(tag) {
  const username = `e2e_${tag}_${stamp}`.slice(0, 20);
  const email = `${username}@example.com`;
  // Created as already confirmed, so the test does not depend on the email setting.
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (created.error) throw new Error(`createUser ${tag}: ${created.error.message}`);
  const client = createClient(SUPABASE_URL, PUBLIC_KEY, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`signIn ${tag}: ${signedIn.error.message}`);
  return { id: created.data.user.id, username, client, token: signedIn.data.session.access_token };
}

async function api(user, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const users = [];
let battleId = null;
try {
  const health = await api(null, "GET", "/api/health");
  check("Worker is running", health.status === 200, API);
  if (health.status !== 200) throw new Error("Start the Worker first: npx wrangler dev");

  // ---- accounts -----------------------------------------------------------
  const alice = await makeUser("a");
  const bob = await makeUser("b");
  const carol = await makeUser("c");
  users.push(alice, bob, carol);
  const profile = await alice.client.from("profiles").select("username, rating").eq("id", alice.id);
  check(
    "Sign-up trigger created a profile at 1200",
    profile.data?.[0]?.rating === 1200 && profile.data[0].username === alice.username,
  );
  const dup = await admin.auth.admin.createUser({
    email: `dup_${stamp}@example.com`,
    password,
    email_confirm: true,
    user_metadata: { username: alice.username.toUpperCase() },
  });
  check("Duplicate username (different case) is rejected", Boolean(dup.error));
  const avail = await createClient(SUPABASE_URL, PUBLIC_KEY).rpc("is_username_available", {
    p_username: alice.username,
  });
  check("Username availability check works for visitors", avail.data === false);

  // ---- auth on the Worker ---------------------------------------------------
  check(
    "Worker rejects a missing token",
    (await api(null, "POST", "/api/matchmaking/join")).status === 401,
  );
  const forged = await api({ token: "not-a-real-token" }, "POST", "/api/matchmaking/join");
  check("Worker rejects a forged token", forged.status === 401, `status ${forged.status}`);

  // ---- matchmaking ----------------------------------------------------------
  const q1 = await api(alice, "POST", "/api/matchmaking/join");
  check("First player is queued", q1.body?.status === "queued", JSON.stringify(q1.body));
  const q2 = await api(bob, "POST", "/api/matchmaking/join");
  check("Second player is matched", q2.body?.status === "matched", JSON.stringify(q2.body));
  battleId = q2.body?.battleId;
  const q3 = await api(alice, "POST", "/api/matchmaking/join");
  check("Waiting player learns of the same battle", q3.body?.battleId === battleId);
  check(
    "Active battle lookup",
    (await api(alice, "GET", "/api/battles/active")).body?.battleId === battleId,
  );

  // ---- get-ready phase and RLS ---------------------------------------------
  const ready = await api(alice, "GET", `/api/battles/${battleId}`);
  check(
    "Problem is withheld during get-ready",
    ready.status === 200 && ready.body.problem === null,
  );
  check(
    "Outsider cannot open the battle",
    (await api(carol, "GET", `/api/battles/${battleId}`)).status === 403,
  );

  const early = await alice.client.from("problems").select("id");
  check("RLS: problem not readable before start", (early.data ?? []).length === 0);
  const hidden = await alice.client.from("problem_tests").select("id").limit(1);
  check(
    "RLS: hidden tests never readable by a player",
    Boolean(hidden.error) || (hidden.data ?? []).length === 0,
  );
  const queue = await alice.client.from("matchmaking_queue").select("user_id").limit(1);
  check("RLS: queue not readable", Boolean(queue.error) || (queue.data ?? []).length === 0);
  const mine = await alice.client.from("battles").select("id");
  check("RLS: player sees own battle", (mine.data ?? []).length === 1);
  const theirs = await carol.client.from("battles").select("id");
  check("RLS: outsider sees no battles", (theirs.data ?? []).length === 0);
  const cheat = await alice.client
    .from("profiles")
    .update({ rating: 3000 })
    .eq("id", alice.id)
    .select();
  check(
    "RLS: player cannot change own rating",
    Boolean(cheat.error) || (cheat.data ?? []).length === 0,
  );
  const rpcCheat = await alice.client.rpc("finish_battle", {
    p_battle: battleId,
    p_winner: alice.id,
    p_reason: "solved",
  });
  check("Player cannot call finish_battle directly", Boolean(rpcCheat.error));

  // ---- realtime -------------------------------------------------------------
  let changeEvents = 0;
  let presenceIds = [];
  const changes = alice.client
    .channel(`battle-changes:${battleId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "battle_players", filter: `battle_id=eq.${battleId}` },
      () => changeEvents++,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "battles", filter: `id=eq.${battleId}` },
      () => changeEvents++,
    );
  const subscribed = (channel, onJoin) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve("TIMEOUT"), 15_000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          Promise.resolve(onJoin?.()).then(() => resolve(status));
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          resolve(status);
        }
      });
    });
  check("Realtime: row-change channel subscribes", (await subscribed(changes)) === "SUBSCRIBED");

  const presenceOf = (user) =>
    user.client.channel(`battle:${battleId}`, {
      config: { private: true, presence: { key: user.id } },
    });
  const alicePresence = presenceOf(alice);
  alicePresence.on("presence", { event: "sync" }, () => {
    presenceIds = Object.keys(alicePresence.presenceState());
  });
  const aStatus = await subscribed(alicePresence, () => alicePresence.track({ online: true }));
  const bobPresence = presenceOf(bob);
  const bStatus = await subscribed(bobPresence, () => bobPresence.track({ online: true }));
  check(
    "Realtime: private presence channel subscribes for both players",
    aStatus === "SUBSCRIBED" && bStatus === "SUBSCRIBED",
    `${aStatus}/${bStatus}`,
  );
  const carolStatus = await subscribed(presenceOf(carol));
  check(
    "Realtime: outsider is refused the presence channel",
    carolStatus !== "SUBSCRIBED",
    carolStatus,
  );

  // ---- battle starts --------------------------------------------------------
  const tooEarly = await api(alice, "POST", `/api/battles/${battleId}/submit`, {
    language: "python",
    code: "print(1)",
  });
  check("Submit before start is refused", tooEarly.status === 409, tooEarly.body?.error?.code);

  const startsAt = Date.parse(ready.body.battle.startsAt);
  const offset = Date.parse(ready.body.serverTime) - Date.now();
  await sleep(Math.max(0, startsAt - (Date.now() + offset)) + 1500);
  const started = await api(alice, "GET", `/api/battles/${battleId}`);
  check(
    "Problem appears after the countdown",
    Boolean(started.body?.problem?.title),
    started.body?.problem?.title,
  );
  const nowReadable = await alice.client.from("problems").select("slug");
  check("RLS: problem readable after start", (nowReadable.data ?? []).length === 1);
  check(
    "Presence shows both players online",
    presenceIds.includes(alice.id) && presenceIds.includes(bob.id),
    `${presenceIds.length} online`,
  );

  // ---- run and submit -------------------------------------------------------
  const slug = nowReadable.data?.[0]?.slug;
  const SOLUTIONS = {
    "sum-of-evens":
      "import sys\nd=sys.stdin.read().split()\nprint(sum(int(x) for x in d[1:] if int(x)%2==0))",
    "count-vowels": "import sys\nprint(sum(c in 'aeiouAEIOU' for c in sys.stdin.readline()))",
    "second-largest":
      "import sys\nd=sorted(set(map(int,sys.stdin.read().split()[1:])),reverse=True)\nprint(d[1] if len(d)>1 else -1)",
    "reverse-words": "import sys\nprint(' '.join(reversed(sys.stdin.readline().split())))",
    "digit-root":
      "import sys\nn=sys.stdin.readline().strip()\ns=sum(map(int,n))\nwhile s>9:\n    s=sum(map(int,str(s)))\nprint(s)",
    "peak-count":
      "import sys\nd=sys.stdin.read().split()\na=list(map(int,d[1:]))\nprint(sum(1 for i in range(1,len(a)-1) if a[i]>a[i-1] and a[i]>a[i+1]))",
  };
  const good = REAL_JUDGE ? SOLUTIONS[slug] : "print('solved')";
  const bad = REAL_JUDGE ? "print(-12345)" : "# MOCK:PASS=2";
  if (REAL_JUDGE && !good) throw new Error(`No reference solution in this script for ${slug}`);

  const run = await api(alice, "POST", `/api/battles/${battleId}/run`, {
    language: "python",
    code: good,
  });
  check(
    "Run on samples is accepted",
    run.body?.verdict === "accepted",
    `${run.body?.passed}/${run.body?.total} ${run.body?.error?.code ?? ""}`,
  );

  const wrong = await api(bob, "POST", `/api/battles/${battleId}/submit`, {
    language: "python",
    code: bad,
  });
  check(
    "Wrong submission reports a partial score only",
    wrong.body?.verdict === "wrong_answer" && !("cases" in (wrong.body ?? {})),
    `${wrong.body?.passed}/${wrong.body?.total} ${wrong.body?.error?.code ?? ""}`,
  );
  const again = await api(bob, "POST", `/api/battles/${battleId}/submit`, {
    language: "python",
    code: bad,
  });
  check(
    "Cooldown is enforced",
    again.status === 429 && again.body?.error?.retryAfterMs > 0,
    again.body?.error?.code,
  );

  await sleep(2500);
  check(
    "Realtime: opponent's progress arrived as a live event",
    changeEvents > 0,
    `${changeEvents} events`,
  );
  const peek = await alice.client.from("submissions").select("id").eq("user_id", bob.id);
  check("RLS: opponent's code hidden during the battle", (peek.data ?? []).length === 0);

  const win = await api(alice, "POST", `/api/battles/${battleId}/submit`, {
    language: "python",
    code: good,
  });
  check(
    "Full solve ends the battle",
    win.body?.verdict === "accepted" && win.body?.battleFinished === true,
    `${win.body?.passed}/${win.body?.total} ${win.body?.error?.code ?? ""}`,
  );

  // ---- result ---------------------------------------------------------------
  const final = await api(bob, "GET", `/api/battles/${battleId}`);
  const me = final.body?.players?.find((p) => p.isYou);
  const other = final.body?.players?.find((p) => !p.isYou);
  check(
    "Result: winner, reason and ratings",
    final.body?.battle?.status === "finished" &&
      final.body.battle.winnerId === alice.id &&
      final.body.battle.finishReason === "solved" &&
      me?.ratingAfter === 1184 &&
      other?.ratingAfter === 1216,
    `${other?.ratingAfter} / ${me?.ratingAfter}`,
  );
  const late = await api(bob, "POST", `/api/battles/${battleId}/submit`, {
    language: "python",
    code: good,
  });
  check("Loser cannot submit after the battle", late.status === 409);
  const reveal = await alice.client
    .from("submissions")
    .select("source_code, kind")
    .eq("user_id", bob.id);
  check(
    "Opponent's submitted code is readable after the battle",
    (reveal.data ?? []).length === 1 && reveal.data[0].kind === "submit",
  );
  const outsider = await carol.client.from("submissions").select("id");
  check("RLS: outsider sees no submissions", (outsider.data ?? []).length === 0);

  // ---- pages that read Supabase directly -----------------------------------
  const board = await createClient(SUPABASE_URL, PUBLIC_KEY)
    .from("leaderboard")
    .select("id, username, rating, wins, losses, draws, rank")
    .order("rating", { ascending: false })
    .limit(50);
  const top = board.data?.find((r) => r.id === alice.id);
  check(
    "Leaderboard is public and shows the new rating",
    top?.rating === 1216 && top.wins === 1,
    board.error?.message,
  );

  const history = await alice.client
    .from("battle_players")
    .select(
      "battle_id, result, rating_before, rating_after, language, best_passed, battles(finished_at, problems(title))",
    )
    .eq("user_id", alice.id)
    .not("rating_after", "is", null);
  const row = history.data?.[0];
  check(
    "History query returns the battle with its problem title",
    row?.result === "win" && Boolean(row?.battles?.problems?.title),
    history.error?.message ?? row?.battles?.problems?.title,
  );
  const opp = await alice.client
    .from("battle_players")
    .select("battle_id, profiles(username)")
    .in("battle_id", [battleId])
    .neq("user_id", alice.id);
  check(
    "History query returns the opponent's name",
    opp.data?.[0]?.profiles?.username === bob.username,
    opp.error?.message,
  );
  const ratingHistory = await alice.client
    .from("rating_history")
    .select("delta")
    .eq("user_id", alice.id);
  check("Rating history view", ratingHistory.data?.[0]?.delta === 16, ratingHistory.error?.message);
} catch (error) {
  failures++;
  console.log(`ERROR ${error.message}`);
} finally {
  // ---- clean up: remove the temporary accounts and their battle -------------
  for (const user of users) {
    await user.client.removeAllChannels().catch(() => {});
    await admin.auth.admin.deleteUser(user.id).catch(() => {});
  }
  if (worker.SUPABASE_DB_URL) {
    const db = new pg.Client({
      connectionString: worker.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await db.connect();
      const removed = await db.query(
        "delete from public.battles b where not exists (select 1 from public.battle_players p where p.battle_id = b.id)",
      );
      const left = await db.query(
        "select count(*)::int as n from public.profiles where username like 'e2e\\_%'",
      );
      console.log(
        `Cleanup: removed ${removed.rowCount} battle(s); ${left.rows[0].n} test profiles left.`,
      );
    } finally {
      await db.end().catch(() => {});
    }
  }
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
