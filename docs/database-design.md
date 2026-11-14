# Database Design

Status: **Gate 2 approved 2026-11-14.**
Last updated: 2026-11-14

All tables live in `public`, have RLS enabled, and are changed only through migrations in `supabase/migrations/`.

## 1. Tables

### profiles
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | references `auth.users(id)` on delete cascade |
| username | text not null | 3–20 chars, `^[A-Za-z0-9_]+$`; unique index on `lower(username)` (no extension needed) |
| rating | int not null default 1200 | |
| wins, losses, draws | int not null default 0 | |
| created_at | timestamptz default now() | |

Created by a trigger on `auth.users` insert from sign-up metadata. No client insert, update or delete.

### problems
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| slug | text unique | |
| title | text | |
| statement_md | text | Markdown statement including constraints |
| difficulty | text | `easy`, `medium`, `hard` |
| samples | jsonb | Array of `{input, output, explanation?}` shown to players and used by Run |
| time_limit_ms | int default 2000 | |
| memory_limit_kb | int default 128000 | |
| is_active | boolean default true | |

### problem_tests (hidden tests)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| problem_id | uuid FK | |
| ordinal | int | execution order; unique with problem_id |
| input | text | |
| expected_output | text | |

No client policies at all. Only the service role reads this table.

### matchmaking_queue
| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK | one queue entry per user |
| rating | int | snapshot at join |
| joined_at | timestamptz | drives window widening and the 60 s timeout |
| heartbeat_at | timestamptz | entries older than 15 s are ignored |

No client policies. Managed only by functions.

### battles
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| problem_id | uuid FK | |
| status | text | `active`, `finished`, `cancelled` |
| starts_at | timestamptz | match time + 10 s |
| ends_at | timestamptz | starts_at + 15 min |
| finished_at | timestamptz null | |
| winner_id | uuid null | null on draw |
| finish_reason | text null | `solved`, `timeout_score`, `timeout_draw`, `forfeit` |
| created_at | timestamptz | |

### battle_players
| Column | Type | Notes |
|---|---|---|
| battle_id | uuid FK | PK (battle_id, user_id) |
| user_id | uuid FK | |
| is_active | boolean | true while the battle is active |
| language | text null | last language used |
| attempts | int default 0 | Submit count |
| best_passed | int default 0 | hidden tests passed by best submission |
| best_passed_at | timestamptz null | tie information for display |
| rating_before | int | snapshot at match |
| rating_after | int null | set on finish |
| result | text null | `win`, `loss`, `draw` |

Unique index: `(user_id) WHERE is_active` — at most one active battle per user.

### submissions
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| battle_id, user_id | uuid FK | |
| kind | text | `run` (samples) or `submit` (hidden) |
| language | text | `python`, `java`, `cpp`, `javascript` |
| source_code | text | max 64 KB |
| status | text | `judging`, `done`, `error` |
| verdict | text null | `accepted`, `wrong_answer`, `compile_error`, `runtime_error`, `time_limit`, `memory_limit`, `internal_error` |
| passed, total | int | |
| reserved_executions | int | judge quota reserved at begin; unused part returned on completion |
| compile_output | text null | truncated to 4 KB |
| created_at, judged_at | timestamptz | |

Unique index: `(user_id) WHERE status = 'judging'` — one in-flight submission per user.

### judge_usage
| Column | Type | Notes |
|---|---|---|
| day | date PK | UTC day |
| executions | int | incremented atomically; compared with the configured daily limit |

No client policies.

### Views
- `leaderboard`: username, rating, wins, losses, draws, rank. Public read.
- `rating_history`: from finished `battle_players` rows (user, battle, rating_before, rating_after, delta, result, finished_at). Under RLS a user sees rows for battles they took part in.

## 2. Row Level Security

| Table | anon | authenticated | service role |
|---|---|---|---|
| profiles | select | select | all |
| problems | none | select only if the user is a participant of a battle with this problem and `now() >= starts_at` | all |
| problem_tests | none | none | all |
| matchmaking_queue | none | none | all |
| battles | none | select where the user is a participant | all |
| battle_players | none | select rows of battles the user participates in (includes the opponent's progress row) | all |
| submissions | none | select own rows; plus the opponent's `submit` rows once the shared battle is `finished` | all |
| judge_usage | none | none | all |

There are no client insert, update or delete policies on any table. Every write goes through the Worker.

Realtime: `battles` and `battle_players` are added to the Realtime publication. Presence channel `battle:<id>` is private, with a `realtime.messages` policy allowing only participants.

## 3. Functions

All are `SECURITY DEFINER` with a fixed `search_path`; `EXECUTE` is revoked from `public`, `anon` and `authenticated` and granted to `service_role` only, except where noted.

| Function | Purpose | Concurrency guard |
|---|---|---|
| `handle_new_user()` (trigger) | Create profile on sign-up | unique username |
| `is_username_available(text)` | Sign-up form check; callable by anon | — |
| `is_battle_participant(battle)` | Used by RLS policies; callable by authenticated; answers only about the caller | — |
| `match_window(joined_at)` | Rating gap accepted after waiting | — |
| `find_match(user)` | Join/heartbeat the queue or create a battle; returns the existing battle if the user already has an active one; returns `timeout` after 60 s | transaction advisory lock; active-battle unique index |
| `cancel_matchmaking(user)` | Leave the queue | — |
| `begin_submission(user, battle, kind, language, code)` | Validate and insert a `judging` row; reserve judge quota | in-flight unique index; deadline and cooldown checked with `now()` |
| `complete_submission(submission, verdict, passed, total, compile_output)` | Record result; update player progress; finish battle on full solve | only acts on `judging` rows; calls `finish_battle` |
| `finish_battle(battle, winner, reason)` (internal) | End battle, apply ELO, set results | `SELECT ... FOR UPDATE` on the battle; no-op unless `active` |
| `forfeit_battle(user, battle)` | Opponent wins | via `finish_battle` |
| `finalize_battle_if_expired(battle)` / `finalize_expired_battles()` | Time-up resolution by best_passed; draw on equal | via `finish_battle` |
| `get_battle_state(user, battle)` | One consistent read of battle, players and (after start) the problem, using database time; resolves the battle first if its time is up | participant check |
| `request_finalize(user, battle)` | Participant-checked time-up resolution for the client-triggered finalize route | via `finalize_battle_if_expired` |
| `sweep_stale()` | Mark stuck `judging` rows as `error`; purge stale queue rows | — |

## 4. ELO

`expected = 1 / (1 + 10 ^ ((opp - me) / 400))`, `new = round(me + 32 * (score - expected))` with score 1, 0.5 or 0. Ratings are read inside `finish_battle` under the row lock, so two battles can never apply against a stale rating.

## 5. Indexes
- `battles(status, ends_at)` for the expiry sweep
- `battle_players(user_id, battle_id)` for history
- `profiles(rating desc)` for the leaderboard
- `submissions(battle_id, user_id, created_at desc)`
- `matchmaking_queue(rating)`
