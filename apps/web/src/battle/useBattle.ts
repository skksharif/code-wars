import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type BattleState } from "../lib/api";
import { useServices } from "../services";

export type BattlePhase = "loading" | "ready" | "active" | "expired" | "finished";

export interface BattleView {
  state: BattleState | null;
  /** Set only when the battle could not be loaded at all. */
  error: ApiError | null;
  phase: BattlePhase;
  /** Milliseconds until the battle starts (ready) or ends (active); 0 otherwise. */
  remainingMs: number;
  /** Ids of connected players, or null if presence is unavailable. */
  onlineUserIds: string[] | null;
  refresh: () => Promise<void>;
}

/**
 * Loads a battle and keeps it current. The server is the authority on time:
 * the countdown shown here is derived from the server's clock and is display
 * only. When it reaches zero the client asks the server to resolve the battle.
 */
export function useBattle(battleId: string, userId: string): BattleView {
  const { api, live, timing } = useServices();
  const [state, setState] = useState<BattleState | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [onlineUserIds, setOnlineUserIds] = useState<string[] | null>(null);

  const stateRef = useRef<BattleState | null>(null);
  const offsetRef = useRef(0);
  const lastAutoActionRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const next = await api.getBattle(battleId);
      const offset = Date.parse(next.serverTime) - Date.now();
      stateRef.current = next;
      offsetRef.current = offset;
      setState(next);
      setClockOffset(offset);
      setError(null);
    } catch (caught) {
      // Keep showing the last known state through a temporary failure.
      if (!stateRef.current) {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError("INTERNAL", "Something went wrong.", 500),
        );
      }
    }
  }, [api, battleId]);

  useEffect(() => {
    stateRef.current = null;
    setState(null);
    void refresh();

    const isLive = () => stateRef.current?.battle.status !== "finished";
    const poll = setInterval(() => {
      if (isLive()) void refresh();
    }, timing.pollMs);
    const stopWatching = live.watchBattle(battleId, userId, {
      onChange: () => void refresh(),
      onPresence: setOnlineUserIds,
    });

    const tick = setInterval(() => {
      setNow(Date.now());
      const current = stateRef.current;
      if (!current || current.battle.status !== "active") return;
      if (Date.now() - lastAutoActionRef.current < timing.retryMs) return;

      const serverNow = Date.now() + offsetRef.current;
      if (serverNow >= Date.parse(current.battle.endsAt)) {
        // Time is up on our clock: the server decides whether it really is.
        lastAutoActionRef.current = Date.now();
        void api
          .finalize(battleId)
          .catch(() => undefined)
          .then(refresh);
      } else if (!current.problem && serverNow >= Date.parse(current.battle.startsAt)) {
        lastAutoActionRef.current = Date.now();
        void refresh();
      }
    }, timing.tickMs);

    return () => {
      clearInterval(poll);
      clearInterval(tick);
      stopWatching();
    };
  }, [api, live, timing, battleId, userId, refresh]);

  const serverNow = now + clockOffset;
  let phase: BattlePhase = "loading";
  let remainingMs = 0;
  if (state) {
    const startsAt = Date.parse(state.battle.startsAt);
    const endsAt = Date.parse(state.battle.endsAt);
    if (state.battle.status !== "active") {
      phase = "finished";
    } else if (serverNow < startsAt || !state.problem) {
      phase = "ready";
      remainingMs = Math.max(0, startsAt - serverNow);
    } else if (serverNow < endsAt) {
      phase = "active";
      remainingMs = endsAt - serverNow;
    } else {
      phase = "expired";
    }
  }

  return { state, error, phase, remainingMs, onlineUserIds, refresh };
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
