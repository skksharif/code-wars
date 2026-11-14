# Requirements

Status: **Gate 1 approved 2026-11-14.** Scope and defaults accepted as proposed.
Last updated: 2026-11-14

## 1. Product

A real-time 1v1 competitive coding platform. Two players of similar rating are matched, receive the same problem, and compete under a fixed time limit. The winner gains rating; the loser loses rating.

## 2. Approved stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind CSS, Monaco Editor |
| Backend/API | Cloudflare Workers |
| Database | Supabase PostgreSQL (source of truth) |
| Auth | Supabase Auth |
| Realtime | Supabase Realtime |
| Code execution | External Judge0 API |
| Hosting | Cloudflare Pages + Supabase |
| Languages offered | Python, Java, C++, JavaScript |

Cost target: ₹0/month on free tiers. No paid infrastructure without approval.

## 3. MVP scope

### In scope
- Email/password registration and login, unique username, profile page, initial rating 1200
- Ranked 1v1 matchmaking: Find Battle, cancel, one active battle per user
- Battle room: problem statement, Monaco editor, language selection, server-authoritative countdown, opponent status, live updates, result screen
- Run (sample tests) and Submit (hidden tests) via the Worker and Judge0
- ELO rating updates, rating history, global leaderboard
- Battle history: opponent, problem, submission results, rating change
- Seed set of about 15 original stdin/stdout problems with sample and hidden tests

### Out of scope (later)
- Friend challenges, rematch, private tournaments, chat, spectating
- OAuth logins, admin UI for problems, anti-plagiarism, mobile-optimised editor

## 4. Battle rules

### Approved (2026-11-14)
- **Win condition:** the first player whose submission passes every hidden test wins immediately and the battle ends.
- **Time-up with no full solve:** the player whose best submission passed more hidden tests wins. Equal scores are a draw, rated with ELO draw maths.
- **Opponent visibility:** online/offline, chosen language, submission attempts, and hidden tests passed by their best submission. Opponent code is never shown during a battle; after it finishes, each player can view the other's final submission.
- **Judge0 source:** hosted free tier, 5–6 hidden tests per problem, with a mock judge for development and automated tests.

### Defaults (approved 2026-11-14)
| Topic | Proposal |
|---|---|
| Battle length | 15 minutes, one problem, difficulty chosen from the players' average rating |
| Match range | ±100 rating, widening by 50 every 10 s, 60 s queue timeout |
| ELO | K=32, no placement matches |
| Submissions | Unlimited, 10 s cooldown, one in flight per user, no wrong-answer penalty |
| Run on sample tests | Allowed, rate-limited more tightly than Submit |
| Hidden test feedback | Verdict and passed/total only; never inputs or expected outputs |
| Disconnect | Battle continues, timer keeps running, player can rejoin; no instant forfeit |
| Leaving | Explicit Forfeit button counts as a loss |
| Editor | Code autosaved locally per battle; paste allowed |
| Email verification | Off for MVP |
| Language versions | Fixed Judge0 versions of Python 3, Java, C++ (GCC), JavaScript (Node) |

## 5. Non-functional requirements
- The client is never trusted for scores, timers, winners or ratings.
- Hidden tests and API credentials are never exposed to the client.
- Critical operations (match creation, battle completion, rating updates) are atomic in Postgres.
- No duplicate active matches, duplicate in-flight submissions, or duplicate rating updates.
- Secrets only in environment variables.

## 6. Technical risks
1. **Judge0 quota.** Hosted free tier is small (about 50 executions/day, to be verified at Gate 2); each test case is one execution. Limits real battles per day.
2. **No long-lived Worker state.** Battle expiry must be enforced from the database (deadline plus scheduled sweep).
3. **Workers free-tier limits.** 10 ms CPU and 50 subrequests per request; Judge0 calls must be batched.
4. **Races.** Matchmaking and battle completion need atomic Postgres functions with row locks.
5. **Supabase free tier.** Project pauses after about a week idle; Realtime connection and message caps.
6. **Hidden test leakage.** Test tables must be unreadable by clients under RLS.
7. **Cheating.** Outside help and second accounts are not addressed in the MVP.

## 7. Decision log

| # | Decision | Reason | Alternatives | Status |
|---|---|---|---|---|
| D1 | First full solve wins instantly | Simple, tense, easy to make server-authoritative | Best score at time-up; solve then execution speed | Approved 2026-11-14 |
| D2 | At time-up, more hidden tests passed wins; equal is a draw | Rewards partial progress | Always a draw; no rating change | Approved 2026-11-14 |
| D3 | Opponent view: status and test progress, never code | Competitive pressure without enabling copying | Status only; live code view | Approved 2026-11-14 |
| D4 | Hosted Judge0 free tier plus mock judge | Keeps cost at ₹0 | Self-hosted Judge0; decide after research | Approved 2026-11-14 |
| D7 | Every Submit runs all hidden tests | Exact partial score | Stop at first failure | Approved 2026-11-14 |
| D8 | Reveal final submissions to both players after the battle | Learning value | Keep private | Approved 2026-11-14 |
| D5 | MVP scope as in section 3 | Smallest complete competitive loop | Include friend challenges or rematch | Approved 2026-11-14 |
| D6 | Defaults table in section 4 | Sensible starting values | Email verification on; other values | Approved 2026-11-14 |
