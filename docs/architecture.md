# Architecture

Status: **Gate 2 approved 2026-11-14.**
Last updated: 2026-11-14

## 1. System overview

```
 Browser (React + Vite + Monaco)                       Cloudflare Pages (static hosting)
   |            |                 |
   | (1) Auth   | (2) Reads +     | (3) Trusted actions (Bearer = Supabase JWT)
   |            |     Realtime    v
   |            |          Cloudflare Worker  (Hono router)
   |            |             |  verify JWT, validate input, rate-limit
   |            |             |  call Judge0, call Postgres functions
   v            v             v                          \
 Supabase Auth  Supabase PostgREST + Realtime             Judge0 (hosted free tier)
        \            |            /                        or MockJudge (dev/tests)
         +------ Supabase PostgreSQL ------+
           tables + RLS + SECURITY DEFINER functions
           (single source of truth, all critical logic atomic here)
```

## 2. Component responsibilities

| Component | Does | Never does |
|---|---|---|
| **Frontend** | Renders UI, signs in via Supabase Auth, reads own/public data through RLS, subscribes to Realtime, calls the Worker for actions, shows a countdown derived from server `ends_at` | Decide winners, scores, ratings or time; see hidden tests; hold any secret |
| **Worker** | Authenticates each request, validates input, orchestrates matchmaking, run/submit, forfeit and finalisation, talks to Judge0, enforces judge quota | Hold state between requests; compute anything the database must guarantee atomically |
| **Postgres** | Stores everything; enforces invariants with constraints, RLS and locked transactions inside functions (match creation, submission accounting, battle completion, ELO) | Call external services |
| **Realtime** | Pushes `battles` and `battle_players` row changes to the two participants; presence for online/offline | Carry authoritative commands from clients |
| **Judge0** | Compiles and runs untrusted code in its sandbox with time and memory limits | Receive user identity or any secret other than its own API key |

## 3. Key flows

### 3.1 Authentication
1. Client signs up with email, password and username via Supabase Auth (username in sign-up metadata).
2. A database trigger on `auth.users` creates the `profiles` row (rating 1200). A duplicate or invalid username fails the sign-up.
3. Client holds the Supabase session. It sends the access token as `Authorization: Bearer` to the Worker.
4. The Worker validates the token with Supabase Auth on every request and derives the user id from it. User ids in request bodies are never accepted.

### 3.2 Matchmaking
1. Client calls `POST /api/matchmaking/join` and repeats it every 5 s as a heartbeat while searching.
2. The Worker calls `find_match(user)`. Inside one transaction the function:
   - takes a transaction-level advisory lock (serialises matchmaking; fine at MVP scale),
   - rejects if the user already has an active battle,
   - looks for the closest-rated queued opponent with a fresh heartbeat (under 15 s) whose window and the caller's window both cover the rating gap (±100, +50 per 10 s waited),
   - if found: removes both from the queue, picks a problem by average rating (preferring one neither has seen), creates the battle and both `battle_players` rows,
   - otherwise upserts the caller into the queue.
3. The matched caller gets the battle id in the response; the waiting player gets it from their next heartbeat (and from a Realtime insert on `battle_players`).
4. `POST /api/matchmaking/cancel` deletes the queue row. Queue entries older than 60 s time out.
5. A partial unique index on `battle_players(user_id) WHERE is_active` makes a second active battle impossible even if logic fails.

### 3.3 Battle timing
- `starts_at = match time + 10 s` (get-ready countdown), `ends_at = starts_at + 15 min`. Both are set by Postgres `now()`.
- The problem is only returned once `now() >= starts_at`.
- The client shows a countdown using `ends_at` and a server-time offset from the Worker. It is display only.
- Submissions are rejected by the database when `now() > ends_at`.
- Expiry: when the countdown hits zero each client calls `POST /api/battles/:id/finalize` (idempotent; does nothing before the deadline). A Worker Cron Trigger runs `finalize_expired_battles()` every minute as a safety net when both clients are gone.

### 3.4 Code execution (Run and Submit)
1. Client posts `{language, code}` to `/run` or `/submit`.
2. Worker calls `begin_submission(...)`: checks participant, battle active, deadline, cooldown, no other in-flight submission (partial unique index), code size; inserts a `judging` row; reserves judge quota.
3. Worker loads tests with the service role (samples for Run, hidden for Submit) and sends all of them to the `JudgeProvider` with the problem's time and memory limits. Every test is always run, so the partial score is exact. The first test runs alone, so a compile error or judge outage costs one execution; the rest then run in parallel.
4. Worker calls `complete_submission(...)` with verdict and passed count. In the same transaction the function updates `battle_players` (attempts, best_passed) and, if every hidden test passed, calls `finish_battle`.
5. Response to the player: verdict, passed/total, compile error text, and for sample tests only the stdout/expected diff. Nothing about hidden test content.
6. A `judging` row older than 90 s is marked `error` by the sweep and does not block the player.

`JudgeProvider` is an interface with two implementations: `Judge0Provider` (hosted API) and `MockJudgeProvider` (deterministic, used in development and tests). Selected by environment variable.

### 3.5 Battle completion and rating
`finish_battle(battle, winner, reason)` is the only path that ends a battle. It locks the battle row, returns immediately if the battle is not `active` (so double calls are harmless), computes ELO (K=32) from the ratings read under lock, updates both `profiles`, writes `rating_before/after` and result to `battle_players`, and sets the battle to `finished`. Reasons: `solved`, `timeout_score`, `timeout_draw`, `forfeit`.

### 3.6 Live updates
- Postgres Changes subscriptions on `battles` and `battle_players` filtered by battle id; RLS limits delivery to the two participants.
- Presence on a private channel `battle:<id>` for online/offline, authorised by a Realtime RLS policy (participants only).
- On reconnect the client refetches `GET /api/battles/:id`, so missed events never leave the UI wrong.

## 4. Repository layout

```
code-wars/
  apps/web/          React + Vite + Tailwind + Monaco
  apps/worker/       Cloudflare Worker (Hono, zod)
  packages/shared/   Shared TypeScript types and constants (languages, verdicts, limits)
  supabase/
    migrations/      SQL migrations (schema, RLS, functions)
    seed/            Problems and tests
  docs/
```
npm workspaces; TypeScript everywhere; Vitest for tests.

## 5. Important decisions and alternatives

| # | Decision | Reason | Alternatives considered | Status |
|---|---|---|---|---|
| A1 | Critical logic lives in Postgres functions called by the Worker via RPC | Workers have no transactions over HTTP; functions give atomicity and row locks | Direct Postgres connection from the Worker with a driver (adds connection pooling concerns); logic in the Worker with optimistic checks (racy) | Approved 2026-11-14 |
| A2 | Advisory lock serialises matchmaking | Simplest correct approach at this scale | `FOR UPDATE SKIP LOCKED` pairing (more throughput, more subtle) | Approved 2026-11-14 |
| A3 | Judging happens inside the HTTP request; stale rows are swept | No queue or extra infrastructure; within free limits | Async tokens with client polling (more robust to disconnects, no early stop); Cloudflare Queues (paid tier features) | Approved 2026-11-14 |
| A4 | Every Submit runs all hidden tests; score = total tests passed | Exact partial score for the time-up rule | Stop at first failing test (saves quota, coarser score) | Approved 2026-11-14 |
| A5 | Battle expiry via client-triggered idempotent finalize plus Worker cron sweep | Instant results when a client is present, guaranteed completion otherwise | pg_cron in Supabase; Durable Object alarms (not on free plan in the form needed) | Approved 2026-11-14 |
| A6 | Rating history is derived from `battle_players` (rating_before/after) through a view | One write, cannot drift or double-apply | Separate `rating_history` table | Approved 2026-11-14 |
| A7 | Hono router and zod validation in the Worker | Small, free, standard for Workers | Hand-rolled routing | Approved 2026-11-14 |
| A8 | Database tests run on PGlite (in-process Postgres); RLS re-verified on the real project before deployment | No Docker needed, runs in Vitest | Local Supabase stack in Docker (closest to production) | Approved 2026-11-14 |
| A9 | After a battle finishes, each player can view the other's final submission; never during the battle | Learning value | Keep code private always | Approved 2026-11-14 |
| A10 | 10-second get-ready phase before the problem is revealed | Fair simultaneous start | Immediate start | Approved 2026-11-14 |
| A11 | Worker validates JWT by calling Supabase Auth per request | Honors revoked sessions, trivial CPU cost | Local JWKS verification (one fewer network call) | Approved 2026-11-14 |

## 6. Free-tier limits that shape the design (checked 2026-11-14)

| Service | Limit | Effect |
|---|---|---|
| Judge0 hosted Basic | Pay per use ($0.0017 per execution) as found on 2026-11-15; no free allowance | A daily quota counter in the database; the Worker refuses politely when exhausted. Roughly 4–8 real battles a day, since every Submit costs one execution per hidden test |
| Cloudflare Workers Free | 100,000 requests/day, 10 ms CPU per request, 50 subrequests per request, 5 cron triggers | A submit uses about 12 subrequests; heartbeat every 5 s is fine for tens of concurrent users |
| Supabase Free | 500 MB database, 200 concurrent Realtime connections, 100 messages/s, pauses after 7 idle days, 2 projects | Fine for MVP; the pause must be handled before any public launch |

Sources: Judge0 pricing (judge0.com/ce, RapidAPI), Cloudflare Workers limits page, Supabase Realtime limits and pricing pages. Third-party summaries were used for some figures; exact values are re-checked at Gate 6.
