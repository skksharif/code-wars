import type { Hono } from "hono";
import type { AppContext } from "../app";

interface FindMatchResult {
  status: "queued" | "matched" | "timeout";
  battle_id?: string;
  waited_ms?: number;
}

export function registerMatchmakingRoutes(app: Hono<AppContext>): void {
  // Join the queue or refresh the heartbeat. Clients call this every 5 seconds
  // while searching; pairing itself is decided atomically in the database.
  app.post("/api/matchmaking/join", async (c) => {
    const result = await c.get("db").rpc<FindMatchResult>("find_match", {
      p_user: c.get("userId"),
    });
    if (result.status === "matched") {
      return c.json({ status: "matched", battleId: result.battle_id });
    }
    if (result.status === "timeout") {
      return c.json({ status: "timeout" });
    }
    return c.json({ status: "queued", waitedMs: result.waited_ms ?? 0 });
  });

  app.post("/api/matchmaking/cancel", async (c) => {
    await c.get("db").rpc("cancel_matchmaking", { p_user: c.get("userId") });
    return c.json({ ok: true });
  });

  // Lets the client resume a battle after a reload.
  app.get("/api/battles/active", async (c) => {
    const rows = await c
      .get("db")
      .select<{ battle_id: string }>(
        "battle_players",
        `user_id=eq.${encodeURIComponent(c.get("userId"))}&is_active=eq.true&select=battle_id`,
      );
    return c.json({ battleId: rows[0]?.battle_id ?? null });
  });
}
