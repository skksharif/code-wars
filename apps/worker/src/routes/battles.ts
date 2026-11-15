import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../app";
import type { Db } from "../db";
import { ApiError } from "../errors";

const uuidSchema = z.string().uuid();

function battleId(c: Context<AppContext>): string {
  const parsed = uuidSchema.safeParse(c.req.param("id"));
  if (!parsed.success) throw new ApiError("INVALID_INPUT");
  return parsed.data;
}

interface BattleStateRow {
  server_time: string;
  battle: {
    id: string;
    status: string;
    starts_at: string;
    ends_at: string;
    finished_at: string | null;
    winner_id: string | null;
    finish_reason: string | null;
  };
  players: {
    user_id: string;
    username: string;
    avatar: string;
    is_you: boolean;
    language: string | null;
    attempts: number;
    best_passed: number;
    rating_before: number;
    rating_after: number | null;
    result: string | null;
  }[];
  total_tests: number;
  problem: {
    title: string;
    difficulty: string;
    statement_md: string;
    samples: { input: string; output: string; explanation?: string }[];
    time_limit_ms: number;
    memory_limit_kb: number;
  } | null;
}

export function registerBattleRoutes(app: Hono<AppContext>): void {
  // Full battle state for a participant. Used on load and after a reconnect,
  // so the client never depends on having received every live update.
  app.get("/api/battles/:id", async (c) => {
    const state = await c.get("db").rpc<BattleStateRow>("get_battle_state", {
      p_user: c.get("userId"),
      p_battle: battleId(c),
    });
    return c.json({
      serverTime: state.server_time,
      battle: {
        id: state.battle.id,
        status: state.battle.status,
        startsAt: state.battle.starts_at,
        endsAt: state.battle.ends_at,
        finishedAt: state.battle.finished_at,
        winnerId: state.battle.winner_id,
        finishReason: state.battle.finish_reason,
      },
      players: state.players.map((p) => ({
        userId: p.user_id,
        username: p.username,
        avatar: p.avatar,
        isYou: p.is_you,
        language: p.language,
        attempts: p.attempts,
        bestPassed: p.best_passed,
        ratingBefore: p.rating_before,
        ratingAfter: p.rating_after,
        result: p.result,
      })),
      totalTests: state.total_tests,
      // null until the get-ready countdown is over.
      problem: state.problem && {
        title: state.problem.title,
        difficulty: state.problem.difficulty,
        statementMd: state.problem.statement_md,
        samples: state.problem.samples,
        timeLimitMs: state.problem.time_limit_ms,
        memoryLimitKb: state.problem.memory_limit_kb,
      },
    });
  });

  app.post("/api/battles/:id/forfeit", async (c) => {
    await c.get("db").rpc("forfeit_battle", { p_user: c.get("userId"), p_battle: battleId(c) });
    return c.json({ ok: true });
  });

  // Clients call this when their countdown reaches zero. The database decides
  // whether time is really up; before the deadline this does nothing.
  app.post("/api/battles/:id/finalize", async (c) => {
    const finished = await c.get("db").rpc<boolean>("request_finalize", {
      p_user: c.get("userId"),
      p_battle: battleId(c),
    });
    return c.json({ finished });
  });
}

/**
 * Safety net run every minute by a Cron Trigger: resolves battles whose time
 * is up even if both players have left, and clears stuck rows.
 */
export async function runScheduledSweep(db: Db): Promise<{ finalized: number }> {
  const finalized = await db.rpc<number>("finalize_expired_battles");
  await db.rpc("sweep_stale");
  return { finalized };
}
