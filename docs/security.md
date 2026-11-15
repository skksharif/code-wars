# Security

Status: **Gate 2 approved 2026-11-14.**
Last updated: 2026-11-14

## 1. Trust boundaries

| Party | Trusted for |
|---|---|
| Browser | Nothing. Supplies only code, language choice and intent (join, cancel, forfeit) |
| Worker | Identity checks, orchestration, judge calls |
| Postgres | Final authority on state, time (`now()`), scores, winners and ratings |
| Judge0 | Sandboxed execution only |

## 2. Secrets

| Secret | Lives in | Exposed to browser |
|---|---|---|
| Supabase service role key | Worker secret (`wrangler secret`) | Never |
| Judge0 API key | Worker secret | Never |
| Supabase URL and anon key | Frontend build env | Yes, by design; protected by RLS |

`.dev.vars` and `.env*` are git-ignored; `.env.example` files document names only. No credential is hardcoded.

## 3. Threats and controls

| Threat | Control |
|---|---|
| Forged winner, score, rating or timer | No API accepts these; all derived in Postgres functions |
| Acting as another user | User id taken only from the validated JWT |
| Reading hidden tests | `problem_tests` has no client policies; expected outputs are compared in the Worker and never sent to the client or to Judge0 |
| Reading the problem pool in advance | `problems` readable only by participants of a started battle |
| Reading the opponent's code during a battle | `submissions` RLS is own-rows only while the battle is active; the opponent's submitted code becomes readable to the other participant only after the battle is `finished` (approved decision A9) |
| Direct table writes with the anon key | No insert, update or delete policies anywhere |
| Calling privileged functions directly | `EXECUTE` revoked from `anon` and `authenticated` |
| Double match, double submit, double rating update | Unique partial indexes, advisory lock, `FOR UPDATE` and idempotent `finish_battle` |
| Late submissions | Deadline checked against database time |
| Judge quota abuse or spam | Cooldowns, one in-flight submission, 64 KB code limit, daily quota counter |
| Malicious code execution | Runs only inside Judge0's sandbox with time and memory limits; the Worker never evaluates user code |
| Cross-origin abuse | CORS allow-list: the Pages origin and localhost in development |
| Leaking internals | Generic 500 responses; details only in Worker logs |
| XSS through problem statements or usernames | Markdown rendered with sanitisation; usernames restricted to `[A-Za-z0-9_]` |
| Eavesdropping on presence | Private Realtime channel restricted to participants |

## 4. Accepted risks for the MVP (need your awareness)

1. **Email verification is off** (approved at Gate 1). Throwaway accounts and rating manipulation with second accounts are possible.
2. **No anti-cheat.** Outside help, AI tools and collusion are not detected.
3. **User code is sent to a third-party judge** (Judge0 hosted). No personal data is sent with it.
4. **No password-strength rules beyond the Supabase default** (minimum 6 characters) unless you want stricter ones.
5. **Free-tier rate limiting only.** A determined attacker could exhaust the daily judge quota or the 100,000 Worker requests; this causes downtime, not data loss or cost.

6. **Hidden tests live in the repository** (`supabase/seed/problems.ts` and the generated `seed.sql`). The GitHub repository must stay private, or anyone can read the hidden tests and reference solutions. Product owner decision 2026-11-14 was a private repository; **superseded 2026-11-15: the product owner chose a public repository (github.com/skksharif/code-wars) and accepted that hidden tests and reference solutions are publicly readable.** **Mitigated 2026-11-15:** randomised hidden tests are now derived from a secret salt (`HIDDEN_TEST_SALT`, kept only in the git-ignored `apps/worker/.dev.vars`), the generated seed is written to the git-ignored `supabase/seed/.generated/`, and the live database was reseeded. Every problem has at least one secret test, so passing all hidden tests needs a real solution. Still public: the problem statements, samples, reference solutions and 45 small hand-written edge cases; the old tests remain in git history but no longer match the live database.
7. **Realtime policies verified 2026-11-15** on the real project: both players can join the private presence channel and an outsider is refused.
9. **Keys were shared in a chat on 2026-11-15** (Supabase secret key and database password). They should be rotated before any public launch.

8. **The mock judge accepts any code.** `JUDGE_PROVIDER` has no default and the Worker refuses to start judging without it, but `wrangler.jsonc` currently sets it to `mock` for development. It must be changed to `judge0` at Gate 6.

## 5. Verification before deployment (Gate 6)
- Automated tests that an authenticated non-participant cannot read a battle, problem or submission, and that anon cannot read anything except profiles and the leaderboard.
- Check that the built frontend bundle contains no service role key or Judge0 key.
- Check function grants and RLS state on the live project.
- Confirm the deployed Worker has `JUDGE_PROVIDER=judge0`.
