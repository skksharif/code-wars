import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { App } from "../App";
import { AuthProvider } from "../auth/AuthContext";
import type { ApiClient, BattlePlayer, BattleState } from "../lib/api";
import type {
  BattleWatchHandlers,
  FinalSubmission,
  HistoryEntry,
  LeaderboardEntry,
  PublicProfile,
} from "../lib/live";
import { ServicesProvider, type Services } from "../services";
import type { FakeAuth } from "./fakeAuth";

export const BATTLE_ID = "11111111-1111-4111-8111-111111111111";

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

export function player(overrides: Partial<BattlePlayer> = {}): BattlePlayer {
  return {
    userId: "user-1",
    username: "coder_42",
    avatar: "nova",
    isYou: true,
    language: null,
    attempts: 0,
    bestPassed: 0,
    ratingBefore: 1200,
    ratingAfter: null,
    result: null,
    ...overrides,
  };
}

export const RIVAL = { userId: "user-2", username: "byte_rival", isYou: false } as const;

/** An active battle that started a minute ago, unless overridden. */
export function battleState(overrides: Partial<BattleState> = {}): BattleState {
  return {
    serverTime: iso(0),
    battle: {
      id: BATTLE_ID,
      status: "active",
      startsAt: iso(-60_000),
      endsAt: iso(840_000),
      finishedAt: null,
      winnerId: null,
      finishReason: null,
    },
    players: [player(), player(RIVAL)],
    totalTests: 5,
    problem: {
      title: "Count the Peaks",
      difficulty: "easy",
      statementMd: "Count the **peaks** in a list.\n\n### Input\nA list.",
      samples: [{ input: "3\n1 2 1", output: "1", explanation: "The 2 is a peak." }],
      timeLimitMs: 2000,
      memoryLimitKb: 128000,
    },
    ...overrides,
  };
}

export function finishedState(
  yours: Partial<BattlePlayer>,
  theirs: Partial<BattlePlayer>,
  battle: Partial<BattleState["battle"]>,
): BattleState {
  const base = battleState();
  return {
    ...base,
    battle: { ...base.battle, status: "finished", finishedAt: iso(0), ...battle },
    players: [player(yours), player({ ...RIVAL, ...theirs })],
  };
}

export interface FakeServices extends Services {
  api: { [K in keyof ApiClient]: ReturnType<typeof vi.fn<ApiClient[K]>> };
  /** Handlers registered by the battle page, to simulate live events. */
  watchers: BattleWatchHandlers[];
  solutions: FinalSubmission[];
  leaderboard: LeaderboardEntry[] | Error;
  history: HistoryEntry[] | Error;
  profiles: Record<string, PublicProfile> | Error;
}

export function createFakeServices(): FakeServices {
  const watchers: BattleWatchHandlers[] = [];
  const services: FakeServices = {
    watchers,
    solutions: [],
    leaderboard: [],
    history: [],
    profiles: {},
    api: {
      joinMatchmaking: vi.fn<ApiClient["joinMatchmaking"]>(async () => ({
        status: "queued",
        waitedMs: 0,
      })),
      cancelMatchmaking: vi.fn<ApiClient["cancelMatchmaking"]>(async () => undefined),
      getActiveBattle: vi.fn<ApiClient["getActiveBattle"]>(async () => null),
      getBattle: vi.fn<ApiClient["getBattle"]>(async () => battleState()),
      run: vi.fn<ApiClient["run"]>(async () => ({
        verdict: "accepted",
        passed: 1,
        total: 1,
        cases: [{ input: "3\n1 2 1", expected: "1", actual: "1", status: "accepted" }],
      })),
      submit: vi.fn<ApiClient["submit"]>(async () => ({
        submissionId: "s1",
        verdict: "wrong_answer",
        passed: 3,
        total: 5,
        battleFinished: false,
      })),
      forfeit: vi.fn<ApiClient["forfeit"]>(async () => undefined),
      setAvatar: vi.fn<ApiClient["setAvatar"]>(async () => undefined),
      finalize: vi.fn<ApiClient["finalize"]>(async () => true),
    },
    live: {
      watchBattle: (_battleId, _userId, handlers) => {
        watchers.push(handlers);
        return () => {
          watchers.splice(watchers.indexOf(handlers), 1);
        };
      },
    },
    data: {
      getFinalSubmissions: async () => services.solutions,
      getPublicProfile: async (username) => {
        if (services.profiles instanceof Error) throw services.profiles;
        const found = Object.values(services.profiles).find(
          (p) => p.username.toLowerCase() === username.toLowerCase(),
        );
        return found ?? null;
      },
      getLeaderboard: async () => {
        if (services.leaderboard instanceof Error) throw services.leaderboard;
        return services.leaderboard;
      },
      getHistory: async () => {
        if (services.history instanceof Error) throw services.history;
        return services.history;
      },
    },
    // Short intervals so tests run on real timers without waiting.
    timing: { heartbeatMs: 30, tickMs: 20, pollMs: 100_000, retryMs: 40 },
  };
  return services;
}

export function renderWithApp(auth: FakeAuth, services: Services, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider service={auth}>
        <ServicesProvider value={services}>
          <App />
        </ServicesProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}
