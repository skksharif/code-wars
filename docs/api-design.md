# API Design

Status: **Gate 2 approved 2026-11-14.**
Last updated: 2026-11-14

## 1. Worker API

Base path `/api`. Every route except `/api/health` requires `Authorization: Bearer <Supabase access token>`. The user id always comes from the token. Bodies are JSON and validated with zod.

| Method | Path | Body | Success response | Notes |
|---|---|---|---|---|
| GET | `/health` | — | `{ ok: true }` | |
| POST | `/matchmaking/join` | — | `{ status: "queued", waitedMs }`, `{ status: "matched", battleId }` or `{ status: "timeout" }` (60 s without a match; the user is removed from the queue) | Also the heartbeat; call every 5 s while searching |
| POST | `/matchmaking/cancel` | — | `{ ok: true }` | |
| GET | `/battles/active` | — | `{ battleId \| null }` | Used on page load to resume |
| GET | `/battles/:id` | — | `serverTime`, `battle`, `players` (you first, with progress and rating fields), `totalTests`, and `problem` with samples (null until `starts_at`). Own submissions are read directly from Supabase | Participants only |
| POST | `/battles/:id/run` | `{ language, code }` | `{ verdict, passed, total, compileOutput?, cases: [{ input, expected, actual, status }] }` | Sample tests only; 5 s cooldown |
| POST | `/battles/:id/submit` | `{ language, code }` | `{ submissionId, verdict, passed, total, compileOutput?, battleFinished }` | Hidden tests; 10 s cooldown; no test content returned |
| POST | `/profile/avatar` | `{ avatar }` (cipher, kernel, vector, nova, pixel or echo) | `{ avatar }` | Changes only the signed-in player's avatar |
| POST | `/battles/:id/forfeit` | — | `{ ok: true }` | |
| POST | `/battles/:id/finalize` | — | `{ finished: boolean }` | Idempotent; no effect before `ends_at` |
| POST | `/rooms` | `{ difficulty: any\|easy\|medium\|hard, minutes: 10\|15\|30 }` | Room | Custom match. Closes the player's other open room |
| GET | `/rooms/current` | — | `{ room \| null }` | The open room the player hosts or has joined |
| GET | `/rooms/code/:code` | — | Room | Look up before joining. `ROOM_NOT_FOUND`, `ROOM_EXPIRED` (410), `ROOM_FULL` |
| POST | `/rooms/join` | `{ code }` | Room | `ROOM_OWN`, `ROOM_FULL`, `ROOM_EXPIRED`, `ALREADY_IN_BATTLE` |
| GET | `/rooms/:id` | — | Room | Host and guest only |
| POST | `/rooms/:id/leave` | — | `{ ok: true }` | Host closes the room; guest leaves it |
| POST | `/rooms/:id/start` | — | Room with `battleId` | Host only (`NOT_HOST`), needs a guest (`ROOM_NOT_READY`); creates an unrated battle |
| POST | `/battles/:id/rematch` | — | Room | Finished custom battles only; same settings, friend put in if free |

Room: `{ id, code, status: open|started|closed|expired, difficulty, minutes, expiresAt, battleId, isHost, host, guest, serverTime }`, where host and guest are `{ userId, username, avatar, rating }`. `GET /battles/:id` also returns `battle.isRated` and `battle.roomCode`.

Scheduled (Cron Trigger, every minute): `finalize_expired_battles()` and `sweep_stale()`.

### Error format
```json
{ "error": { "code": "COOLDOWN", "message": "Wait 6 seconds before submitting again.", "retryAfterMs": 6000 } }
```

| HTTP | code | Meaning |
|---|---|---|
| 400 | `INVALID_INPUT` | Body failed validation (unknown language, code over 64 KB, ...) |
| 401 | `UNAUTHENTICATED` | Missing or invalid token |
| 403 | `NOT_PARTICIPANT` | User is not in this battle |
| 404 | `NOT_FOUND` | |
| 409 | `ALREADY_IN_BATTLE`, `SUBMISSION_IN_FLIGHT`, `BATTLE_NOT_ACTIVE`, `BATTLE_NOT_STARTED` | State conflicts |
| 429 | `COOLDOWN`, `JUDGE_QUOTA_EXHAUSTED` | Rate or quota limits |
| 502 | `JUDGE_UNAVAILABLE` | Judge0 failed; the submission is not counted |
| 500 | `INTERNAL` | Unexpected; details logged, not returned |

## 2. Direct Supabase access from the client (RLS-protected, read only)

| Data | Source |
|---|---|
| Sign up, sign in, sign out, session | Supabase Auth |
| Username availability | RPC `is_username_available` |
| Leaderboard | view `leaderboard` |
| Any user's public profile page (`/u/<username>`) | RPC `get_public_profile` (callable without logging in) |
| Own battle history and rating history | `battles`, `battle_players`, view `rating_history` |
| Own submissions; opponent's final submission after the battle is finished | `submissions` |

## 3. Realtime

| Channel | Type | Payload | Who |
|---|---|---|---|
| `battles` row, filter `id=eq.<battleId>` | Postgres Changes | status, winner, finish reason | participants (RLS) |
| `battle_players` rows, filter `battle_id=eq.<battleId>` | Postgres Changes | attempts, best_passed, language, result, rating_after | participants (RLS) |
| `battle_players` inserts, filter `user_id=eq.<me>` | Postgres Changes | new battle id | the matched user |
| `battle:<battleId>` | Presence (private channel) | online/offline | participants |
| `lobby` | Presence only (private channel), keyed by user id | players online count shown in the arena | any signed-in player |

Clients never send authoritative data over Realtime.

## 4. Judge provider interface

```ts
interface JudgeProvider {
  execute(req: {
    language: Language;        // python | java | cpp | javascript
    sourceCode: string;
    stdin: string;
    timeLimitMs: number;
    memoryLimitKb: number;
    mockHint?: { index: number; expectedOutput: string }; // mock judge only; never sent to Judge0
  }): Promise<{
    status: "ok" | "compile_error" | "runtime_error" | "time_limit" | "memory_limit" | "internal_error";
    stdout: string;
    compileOutput?: string;
    timeMs?: number;
    memoryKb?: number;
  }>;
}
```
Output comparison (trailing-whitespace-insensitive, line by line) is done in the Worker, so expected outputs are never sent to Judge0.
