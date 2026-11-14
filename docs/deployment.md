# Deployment

Status: **Gate 2 approved 2026-11-14 (design only). Nothing is deployed and no accounts or resources have been created.**
Last updated: 2026-11-14

## 1. Target topology (₹0/month)

| Piece | Host | Plan |
|---|---|---|
| Frontend (static build) | Cloudflare Pages, built from GitHub | Free |
| API | Cloudflare Worker with one Cron Trigger (every minute) | Free |
| Database, Auth, Realtime | Supabase project | Free |
| Code execution | Judge0 CE hosted (RapidAPI Basic) | Free, 50 executions/day |
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

## 5. Release steps (to be executed only after Gate 6 approval)
1. Apply migrations to Supabase (`supabase db push`) and seed problems.
2. Set Supabase Auth settings (email confirmation off, site URL, redirect URLs).
3. Set Worker secrets and vars; `wrangler deploy`.
4. Connect the GitHub repo to Pages; set build env; deploy.
5. Run the post-deploy checklist in `security.md` section 5 and a two-account smoke battle.

## 6. Free-tier limitations
- Judge0: 50 executions per day in total. When exhausted, Run and Submit return a clear "judge quota exhausted" message until 00:00 UTC.
- Supabase: project pauses after 7 days without activity and must be resumed manually; 500 MB database; 200 concurrent Realtime connections.
- Workers: 100,000 requests per day; 10 ms CPU per request.
- Expected cost: ₹0. Any change that could incur cost will be raised for approval first.
