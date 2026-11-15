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
  /**
   * Join the site-wide lobby as `userId` and report how many players are
   * connected (each player once, however many tabs). Returns a function that
   * leaves the lobby.
   */
  joinLobby(userId: string, onCount: (count: number) => void): () => void;
  /** Calls `onChange` when the room row changes (someone joined, left, or it started). */
  watchRoom(roomId: string, onChange: () => void): () => void;
}

export interface FinalSubmission {
  userId: string;
  language: Language;
  sourceCode: string;
  verdict: Verdict | null;
  passed: number;
  total: number;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  avatar: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  rank: number;
}

export interface HistoryEntry {
  battleId: string;
  result: "win" | "loss" | "draw";
  ratingBefore: number;
  ratingAfter: number;
  language: Language | null;
  bestPassed: number;
  finishedAt: string;
  problemTitle: string;
  opponent: string;
  opponentAvatar: string;
  /** False for a custom match (no rating change). */
  isRated: boolean;
}

export interface PublicProfile {
  username: string;
  avatar: string;
  rating: number;
  rank: number;
  memberSince: string;
  wins: number;
  losses: number;
  draws: number;
  peakRating: number;
  streak: { result: "win" | "loss" | "draw"; count: number } | null;
  /** Rating after each finished battle, oldest first, starting before the first one. */
  ratingHistory: number[];
  /** Finished battles per language. */
  languages: Partial<Record<Language, number>>;
  winsByDifficulty: { easy: number; medium: number; hard: number };
  recentBattles: {
    battleId: string;
    result: "win" | "loss" | "draw";
    ratingBefore: number;
    ratingAfter: number;
    opponent: string;
    opponentAvatar: string;
    finishedAt: string;
  }[];
}

/** Read-only data the browser fetches directly from Supabase under RLS. */
export interface BattleData {
  /** Anyone's public profile, or null if there is no such player. */
  getPublicProfile(username: string): Promise<PublicProfile | null>;
  /** Top players by rating. Public. */
  getLeaderboard(limit: number): Promise<LeaderboardEntry[]>;
  /** The user's finished battles, newest first. */
  getHistory(userId: string): Promise<HistoryEntry[]>;
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

    joinLobby(userId, onCount) {
      const lobby = supabase.channel("lobby", {
        config: { private: true, presence: { key: userId } },
      });
      lobby
        .on("presence", { event: "sync" }, () => {
          onCount(Object.keys(lobby.presenceState()).length);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void lobby.track({ online: true });
        });
      return () => {
        void supabase.removeChannel(lobby);
      };
    },

    watchRoom(roomId, onChange) {
      const channel = supabase
        .channel(`room-changes:${roomId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "custom_rooms", filter: `id=eq.${roomId}` },
          () => onChange(),
        )
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
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

interface HistoryRow {
  battle_id: string;
  result: "win" | "loss" | "draw";
  rating_before: number;
  rating_after: number;
  language: Language | null;
  best_passed: number;
  battles: { finished_at: string; is_rated: boolean; problems: { title: string } | null } | null;
}

interface OpponentRow {
  battle_id: string;
  profiles: { username: string; avatar: string } | null;
}

interface PublicProfileRow {
  username: string;
  avatar: string;
  rating: number;
  rank: number;
  member_since: string;
  wins: number;
  losses: number;
  draws: number;
  peak_rating: number;
  streak: PublicProfile["streak"];
  rating_history: number[];
  languages: PublicProfile["languages"];
  wins_by_difficulty: PublicProfile["winsByDifficulty"];
  recent_battles: {
    battle_id: string;
    result: "win" | "loss" | "draw";
    rating_before: number;
    rating_after: number;
    opponent: string | null;
    opponent_avatar: string | null;
    finished_at: string;
  }[];
}

export function createSupabaseBattleData(supabase: SupabaseClient): BattleData {
  return {
    async getPublicProfile(username) {
      const { data, error } = await supabase.rpc("get_public_profile", { p_username: username });
      if (error) throw new Error("Could not load the profile.");
      const row = data as PublicProfileRow | null;
      if (!row) return null;
      return {
        username: row.username,
        avatar: row.avatar,
        rating: row.rating,
        rank: row.rank,
        memberSince: row.member_since,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        peakRating: row.peak_rating,
        streak: row.streak,
        ratingHistory: row.rating_history,
        languages: row.languages,
        winsByDifficulty: row.wins_by_difficulty,
        recentBattles: row.recent_battles.map((b) => ({
          battleId: b.battle_id,
          result: b.result,
          ratingBefore: b.rating_before,
          ratingAfter: b.rating_after,
          opponent: b.opponent ?? "deleted player",
          opponentAvatar: b.opponent_avatar ?? "cipher",
          finishedAt: b.finished_at,
        })),
      };
    },

    async getLeaderboard(limit) {
      const { data, error } = await supabase
        .from("leaderboard")
        .select("id, username, avatar, rating, wins, losses, draws, rank")
        .order("rating", { ascending: false })
        .order("username")
        .limit(limit);
      if (error) throw new Error("Could not load the rankings.");
      return (data ?? []) as LeaderboardEntry[];
    },

    async getHistory(userId) {
      const { data, error } = await supabase
        .from("battle_players")
        .select(
          "battle_id, result, rating_before, rating_after, language, best_passed, battles(finished_at, is_rated, problems(title))",
        )
        .eq("user_id", userId)
        .not("rating_after", "is", null)
        .limit(100);
      if (error) throw new Error("Could not load your battles.");
      const rows = (data ?? []) as unknown as HistoryRow[];
      if (rows.length === 0) return [];

      const opponents = await supabase
        .from("battle_players")
        .select("battle_id, profiles(username, avatar)")
        .in(
          "battle_id",
          rows.map((row) => row.battle_id),
        )
        .neq("user_id", userId);
      if (opponents.error) throw new Error("Could not load your battles.");
      const rivals = new Map(
        ((opponents.data ?? []) as unknown as OpponentRow[]).map((row) => [
          row.battle_id,
          row.profiles,
        ]),
      );

      return rows
        .map((row) => ({
          battleId: row.battle_id,
          result: row.result,
          ratingBefore: row.rating_before,
          ratingAfter: row.rating_after,
          language: row.language,
          bestPassed: row.best_passed,
          finishedAt: row.battles?.finished_at ?? "",
          problemTitle: row.battles?.problems?.title ?? "Unknown problem",
          opponent: rivals.get(row.battle_id)?.username ?? "unknown",
          opponentAvatar: rivals.get(row.battle_id)?.avatar ?? "cipher",
          isRated: row.battles?.is_rated ?? true,
        }))
        .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
    },

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
