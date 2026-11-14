# Implementation Plan

Status: **Gate 2 approved 2026-11-14.**
Last updated: 2026-11-14

## Gates

| Gate | Subject | Status |
|---|---|---|
| 1 | Requirements and MVP scope | Approved 2026-11-14 |
| 2 | Architecture, schema, API, security, deployment design | Approved 2026-11-14 |
| 3 | UI/UX (pages, journey, visual direction) | Approved 2026-11-14: neon esports look with versus-style layout (second mockup) |
| 4 | Implementation, one module at a time | In progress — M0 to M3 approved and committed; M4 built and tested, awaiting approval |
| 5 | Integration | Not started |
| 6 | Deployment | Not started |

## Modules (each ends with tests, a report and an approval request)

| # | Module | Contents | Tests | Depends on |
|---|---|---|---|---|
| M0 | Repository scaffold | git init, npm workspaces, TypeScript, ESLint, Prettier, Vitest, `.gitignore`, `.env.example` files | Tooling runs clean | — |
| M1 | Database | Migrations for tables, indexes, RLS, functions, views; seed problems and tests | Function tests (matchmaking races, submission guards, ELO, idempotent finish, expiry); RLS tests | M0 |
| M2 | Worker core | Hono app, auth middleware, CORS, error format, Supabase client, health route | Unit tests with mocked Supabase | M0 |
| M3 | Matchmaking API | join/heartbeat, cancel, active battle | Unit and integration tests | M1, M2 |
| M4 | Judge and submissions | `JudgeProvider`, MockJudge, Judge0 provider, output comparison, run and submit routes, quota | Unit tests per verdict; Judge0 contract test (uses a few real executions, only with your go-ahead) | M1, M2 |
| M5 | Battle lifecycle | battle detail route, forfeit, finalize, cron sweep | Integration tests | M3, M4 |
| M6 | Frontend foundation | Routing, auth pages, layout, Supabase client, API client | Component tests | Gate 3, M2 |
| M7 | Battle experience | Matchmaking screen, battle room (Monaco, timer, opponent panel, results) | Component tests; manual two-browser test | M5, M6 |
| M8 | Profile, leaderboard, history | Read-only pages | Component tests | M6 |
| M9 | Integration (Gate 5) | End-to-end run against a real Supabase project with MockJudge, then Judge0 | Two-account scripted battle | M1–M8 |
| M10 | Deployment (Gate 6) | Checklist in `deployment.md` | Post-deploy smoke test | M9 |

Gate 3 (UI/UX) can be reviewed while backend modules M1–M5 are in progress, since they do not depend on it.

## Milestone report format
Completed, Files Changed, Tests, Pending, Risks, Next Approval.
