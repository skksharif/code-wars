import { LIMITS } from "@code-wars/shared";
import { createContext, useContext, type ReactNode } from "react";
import type { ApiClient } from "./lib/api";
import type { BattleData, LiveService } from "./lib/live";

/** Intervals in milliseconds. Tests shorten these. */
export interface Timing {
  /** Matchmaking heartbeat. */
  heartbeatMs: number;
  /** Clock tick in the battle room and lobby. */
  tickMs: number;
  /** Fallback refetch of battle state in case a live update is missed. */
  pollMs: number;
  /** Minimum gap between automatic retries (start of battle, time-up). */
  retryMs: number;
}

export const DEFAULT_TIMING: Timing = {
  heartbeatMs: LIMITS.heartbeatIntervalMs,
  tickMs: 250,
  pollMs: 5000,
  retryMs: 2000,
};

export interface Services {
  api: ApiClient;
  live: LiveService;
  data: BattleData;
  timing: Timing;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const value = useContext(ServicesContext);
  if (!value) throw new Error("useServices must be used inside ServicesProvider");
  return value;
}
