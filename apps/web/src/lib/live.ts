import type { Language, Verdict } from "@code-wars/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface BattleWatchHandlers {
  /** Something about the battle changed; the caller refetches the full state. */
  onChange: () => void;
  /** Ids of the players currently connected to the battle. */
  onPresence: (onlineUserIds: string[]) => void;
}

/** Live updates for a battle. Only a hint to refetch: never a source of truth. */
export interface LiveService {
  watchBattle(battleId: string, userId: string, handlers: BattleWatchHandlers): () => void;
}

export interface FinalSubmission {
  userId: string;
  language: Language;
  sourceCode: string;
  verdict: Verdict | null;
  passed: number;
  total: number;
}

/** Read-only data the browser fetches directly from Supabase under RLS. */
export interface BattleData {
  /** Each player's latest submitted solution. The opponent's is readable only after the battle. */
  getFinalSubmissions(battleId: string): Promise<FinalSubmission[]>;
}

export function createSupabaseLive(supabase: SupabaseClient): LiveService {
  return {
    watchBattle(battleId, userId, handlers) {
      const changes = supabase
        .channel(`battle-changes:${battleId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "battles", filter: `id=eq.${battleId}` },
          () => handlers.onChange(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "battle_players",
            filter: `battle_id=eq.${battleId}`,
          },
          () => handlers.onChange(),
        )
        .subscribe();

      // Separate private channel, so a presence problem never blocks row updates.
      const presence = supabase.channel(`battle:${battleId}`, {
        config: { private: true, presence: { key: userId } },
      });
      presence
        .on("presence", { event: "sync" }, () => {
          handlers.onPresence(Object.keys(presence.presenceState()));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void presence.track({ online: true });
        });

      return () => {
        void supabase.removeChannel(changes);
        void supabase.removeChannel(presence);
      };
    },
  };
}

interface SubmissionRow {
  user_id: string;
  language: Language;
  source_code: string;
  verdict: Verdict | null;
  passed: number;
  total: number;
}

export function createSupabaseBattleData(supabase: SupabaseClient): BattleData {
  return {
    async getFinalSubmissions(battleId) {
      const { data, error } = await supabase
        .from("submissions")
        .select("user_id, language, source_code, verdict, passed, total")
        .eq("battle_id", battleId)
        .eq("kind", "submit")
        .eq("status", "done")
        .order("created_at", { ascending: false });
      if (error) throw new Error("Could not load the solutions.");

      const latest = new Map<string, FinalSubmission>();
      for (const row of (data ?? []) as SubmissionRow[]) {
        if (latest.has(row.user_id)) continue;
        latest.set(row.user_id, {
          userId: row.user_id,
          language: row.language,
          sourceCode: row.source_code,
          verdict: row.verdict,
          passed: row.passed,
          total: row.total,
        });
      }
      return [...latest.values()];
    },
  };
}
