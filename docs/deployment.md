# Deployment

Status: **Deployed 2026-11-15 (Gate 6 approved).**

| Piece | Live address | Cloudflare name |
|---|---|---|
| Website | https://code-wars.unified-loans-commercial.workers.dev | Worker `code-wars` (static assets only, `apps/web/wrangler.jsonc`) |
| API | https://code-wars-api.unified-loans-commercial.workers.dev | Worker `code-wars-api` with a cron every minute (`apps/worker/wrangler.jsonc`) |
| Database, Auth, Realtime | Supabase project `ptrdipriebabfpfdxuim` | — |

Cloudflare Pages is now part of Workers, so the website is deployed as a Worker that serves static files, instead of a Pages project.

### Redeploying
- API: `npx wrangler deploy` in `apps/worker`. Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `JUDGE0_API_KEY`) are stored on Cloudflare with `wrangler secret put`.
- Website: in `apps/web`, put `VITE_API_BASE_URL=<API address>` in `.env.production.local` (git-ignored), then `npx vite build` and `npx wrangler deploy`.
- Hidden tests and migrations: `npm run seed:generate` (needs `HIDDEN_TEST_SALT` in `apps/worker/.dev.vars`; writes the git-ignored `supabase/seed/.generated/seed.sql`), then `node scripts/db-apply.mjs`.
- Production check: `API_BASE_URL=<API address> node scripts/e2e-battle.mjs --judge0` (about 12 paid judge runs).
Last updated: 2026-11-14

## 1. Target topology (₹0/month)

| Piece | Host | Plan |
|---|---|---|
| Frontend (static build) | Cloudflare Pages, built from GitHub | Free |
| API | Cloudflare Worker with one Cron Trigger (every minute) | Free |
| Database, Auth, Realtime | Supabase project | Free |
| Code execution | Judge0 CE hosted (RapidAPI Basic) | Pay per use: $0.0017 per execution, capped by `JUDGE_DAILY_LIMIT` (approved 2026-11-15) |
| Source | GitHub repository | Free |

## 2. Environments

| Environment | Frontend | Worker | Database | Judge |
|---|---|---|---|---|
| Local | `vite dev` | `wrangler dev` | Supabase project (or local stack) | MockJudge by default |
| Production | Pages | deployed Worker | Supabase project | Judge0 |

Proposal: one Supabase project during development; decide at Gate 6 whether production gets a separate project (the free plan allows two).

## 3. Configuration

| Variable | Where | Secret |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL` | Pages build env, `apps/web/.env.local` | No |
| `SUPABASE_URL` | Worker var | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker secret, `apps/worker/.dev.vars` | Yes |
| `JUDGE_PROVIDER` (`mock` or `judge0`) | Worker var | No |
| `JUDGE0_API_URL`, `JUDGE0_API_HOST` | Worker var | No |
| `JUDGE0_API_KEY` | Worker secret | Yes |
| `JUDGE_DAILY_LIMIT` (default 50) | Worker var | No |
| `ALLOWED_ORIGINS` | Worker var | No |

## 4. What you will need to provide (at the relevant gates, not now)
- A Supabase account and project (URL, anon key, service role key)
- A Cloudflare account
- A RapidAPI account subscribed to the Judge0 CE Basic (free) plan
- A GitHub repository

I will not create accounts, projects or resources, or deploy anything, without your explicit approval at Gate 6.

## Local development and integration checks

- Apply migrations and seed: `node scripts/db-apply.mjs` (reads `SUPABASE_DB_URL` from `apps/worker/.dev.vars`; `--check` only tests the connection).
- Run the Worker: `npx wrangler dev` in `apps/worker`. Use `http://127.0.0.1:8787`, not `localhost`: on the development machine another program answers on the IPv6 `localhost:8787`.
- End-to-end battle against real Supabase: `node scripts/e2e-battle.mjs` (add `--judge0` when the Worker runs with the real judge).
- Concurrency and cron: `node scripts/e2e-race.mjs` (mock judge only).
- Try the app in a browser: `node scripts/dev-accounts.mjs create` makes two confirmed local test accounts, `bot` makes the second one queue up and play, `remove` deletes them.

## 5. Release steps (to be executed only after Gate 6 approval)
1. Apply migrations to Supabase (`supabase db push`) and seed problems.
2. Set Supabase Auth settings (email confirmation off, site URL, redirect URLs).
3. Set Worker secrets and vars; `wrangler deploy`.
4. Connect the GitHub repo to Pages; set build env; deploy.
5. Run the post-deploy checklist in `security.md` section 5 and a two-account smoke battle.

## 6. Free-tier limitations
- Judge0: not free. Each execution costs $0.0017. The Worker stops at `JUDGE_DAILY_LIMIT` executions a day (set to 200 on 2026-11-15, about $0.34 or ₹30 a day at most); Run and Submit then return a clear "judge quota exhausted" message until 00:00 UTC.
- Supabase: project pauses after 7 days without activity and must be resumed manually; 500 MB database; 200 concurrent Realtime connections.
- Workers: 100,000 requests per day; 10 ms CPU per request.
- Expected cost: ₹0 for hosting and database; up to about ₹900 a month for Judge0 at the cap of 200 runs a day. Any other change that could incur cost will be raised for approval first.
