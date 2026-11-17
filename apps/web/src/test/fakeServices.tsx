import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { App } from "../App";
import { AuthProvider } from "../auth/AuthContext";
import type {
  ApiClient,
  BattlePlayer,
  BattleState,
  Challenge,
  FriendList,
  Notifications,
  Rematch,
  Room,
} from "../lib/api";
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
    solvedInOvertime: false,
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
      isRated: true,
      roomCode: null,
      firstSolvedAt: null,
      overtimeEndsAt: null,
      overtimeOutcome: null,
      overtimeFullDelta: null,
      rematchOf: null,
      series: { you: 0, them: 0, draws: 0 },
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

export const ROOM_ID = "22222222-2222-4222-8222-222222222222";

/** An open custom room hosted by the test user (coder_42), unless overridden. */
export function room(overrides: Partial<Room> = {}): Room {
  return {
    serverTime: iso(0),
    id: ROOM_ID,
    code: "K7M2QX",
    status: "open",
    difficulty: "any",
    minutes: 15,
    expiresAt: iso(29 * 60_000),
    battleId: null,
    isHost: true,
    host: { userId: "user-1", username: "coder_42", avatar: "nova", rating: 1216 },
    guest: null,
    ...overrides,
  };
}

/** No rematch asked yet, window open for 50 more seconds, unless overridden. */
export function rematch(overrides: Partial<Rematch> = {}): Rematch {
  return {
    serverTime: iso(0),
    status: "none",
    requestedByYou: false,
    cancelReason: null,
    newBattleId: null,
    windowEndsAt: iso(50_000),
    rated: true,
    series: { you: 1, them: 0, draws: 0 },
    ...overrides,
  };
}

/** A challenge from the test user (coder_42) to byte_rival, waiting, unless overridden. */
export function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    serverTime: iso(0),
    id: "33333333-3333-4333-8333-333333333333",
    status: "pending",
    cancelReason: null,
    difficulty: "any",
    minutes: 15,
    expiresAt: iso(30_000),
    battleId: null,
    isChallenger: true,
    challenger: { userId: "user-1", username: "coder_42", avatar: "nova", rating: 1216 },
    challenged: { userId: "user-2", username: "byte_rival", avatar: "pixel", rating: 1180 },
    ...overrides,
  };
}

export const ROOM_GUEST = {
  userId: "user-2",
  username: "byte_rival",
  avatar: "pixel",
  rating: 1180,
} as const;

export interface FakeServices extends Services {
  api: { [K in keyof ApiClient]: ReturnType<typeof vi.fn<ApiClient[K]>> };
  /** Handlers registered by the battle page, to simulate live events. */
  watchers: BattleWatchHandlers[];
  /** Who is in the site-wide lobby, and how to tell them the online count. */
  lobby: { userId: string; onMembers: (userIds: string[]) => void }[];
  /** Result screens watching their rematch offer. */
  rematchWatchers: (() => void)[];
  /** App-wide watchers for friend requests and challenges. */
  notificationWatchers: (() => void)[];
  notifications: Notifications;
  friendList: FriendList;
  /** Room pages watching for changes, to simulate live room updates. */
  roomWatchers: (() => void)[];
  solutions: FinalSubmission[];
  leaderboard: LeaderboardEntry[] | Error;
  history: HistoryEntry[] | Error;
  profiles: Record<string, PublicProfile> | Error;
}

export function createFakeServices(): FakeServices {
  const watchers: BattleWatchHandlers[] = [];
  const lobby: FakeServices["lobby"] = [];
  const roomWatchers: (() => void)[] = [];
  const notificationWatchers: (() => void)[] = [];
  const rematchWatchers: (() => void)[] = [];
  const services: FakeServices = {
    rematchWatchers,
    watchers,
    lobby,
    roomWatchers,
    notificationWatchers,
    notifications: {
      serverTime: iso(0),
      friendRequests: 0,
      incomingChallenges: [],
      outgoingChallenge: null,
    },
    friendList: { friends: [], incoming: [], outgoing: [] },
    solutions: [],
    leaderboard: [],
    history: [],
    profiles: {},
    api: {
      getFriends: vi.fn<ApiClient["getFriends"]>(async () => services.friendList),
      getFriendStatus: vi.fn<ApiClient["getFriendStatus"]>(async () => ({
        userId: "user-9",
        status: "none",
        inBattle: false,
        headToHead: { wins: 0, losses: 0, draws: 0 },
      })),
      sendFriendRequest: vi.fn<ApiClient["sendFriendRequest"]>(async () => ({
        status: "outgoing",
        userId: "user-9",
      })),
      respondFriendRequest: vi.fn<ApiClient["respondFriendRequest"]>(async (userId, accept) => ({
        status: accept ? "friends" : "none",
        userId,
      })),
      removeFriend: vi.fn<ApiClient["removeFriend"]>(async () => undefined),
      sendChallenge: vi.fn<ApiClient["sendChallenge"]>(async (userId, difficulty, minutes) =>
        challenge({
          difficulty,
          minutes,
          challenged: { userId, username: "byte_rival", avatar: "pixel", rating: 1180 },
        }),
      ),
      respondChallenge: vi.fn<ApiClient["respondChallenge"]>(async (_id, accept) =>
        challenge({
          isChallenger: false,
          status: accept ? "accepted" : "declined",
          battleId: accept ? BATTLE_ID : null,
        }),
      ),
      cancelChallenge: vi.fn<ApiClient["cancelChallenge"]>(async () =>
        challenge({ status: "cancelled", cancelReason: "withdrawn" }),
      ),
      getNotifications: vi.fn<ApiClient["getNotifications"]>(async () => services.notifications),
      createRoom: vi.fn<ApiClient["createRoom"]>(async (difficulty, minutes) =>
        room({ difficulty, minutes }),
      ),
      getCurrentRoom: vi.fn<ApiClient["getCurrentRoom"]>(async () => null),
      getRoomByCode: vi.fn<ApiClient["getRoomByCode"]>(async (code) =>
        room({
          code,
          isHost: false,
          host: { ...ROOM_GUEST, username: "host_friend", userId: "user-3" },
        }),
      ),
      joinRoom: vi.fn<ApiClient["joinRoom"]>(async () =>
        room({ isHost: false, guest: { ...ROOM_GUEST } }),
      ),
      getRoom: vi.fn<ApiClient["getRoom"]>(async () => room()),
      leaveRoom: vi.fn<ApiClient["leaveRoom"]>(async () => undefined),
      startRoom: vi.fn<ApiClient["startRoom"]>(async () =>
        room({ status: "started", battleId: BATTLE_ID, guest: { ...ROOM_GUEST } }),
      ),
      getRematch: vi.fn<ApiClient["getRematch"]>(async () => rematch()),
      requestRematch: vi.fn<ApiClient["requestRematch"]>(async () =>
        rematch({ status: "pending", requestedByYou: true }),
      ),
      respondRematch: vi.fn<ApiClient["respondRematch"]>(async (_id, accept) =>
        rematch(
          accept
            ? { status: "accepted", newBattleId: "44444444-4444-4444-8444-444444444444" }
            : { status: "declined" },
        ),
      ),
      cancelRematch: vi.fn<ApiClient["cancelRematch"]>(async () =>
        rematch({ status: "cancelled", cancelReason: "withdrawn", requestedByYou: true }),
      ),
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
      watchRematch: (_battleId, onChange) => {
        rematchWatchers.push(onChange);
        return () => {
          rematchWatchers.splice(rematchWatchers.indexOf(onChange), 1);
        };
      },
      watchRoom: (_roomId, onChange) => {
        roomWatchers.push(onChange);
        return () => {
          roomWatchers.splice(roomWatchers.indexOf(onChange), 1);
        };
      },
      watchNotifications: (_userId, onChange) => {
        notificationWatchers.push(onChange);
        return () => {
          notificationWatchers.splice(notificationWatchers.indexOf(onChange), 1);
        };
      },
      joinLobby: (userId, onMembers) => {
        const member = { userId, onMembers };
        lobby.push(member);
        return () => {
          lobby.splice(lobby.indexOf(member), 1);
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
