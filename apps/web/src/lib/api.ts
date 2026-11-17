import type { Language, RoomDifficulty, RoomMinutes, Verdict } from "@code-wars/shared";

/** An error returned by the Worker API, or a network failure (code NETWORK). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export type MatchmakingStatus =
  | { status: "queued"; waitedMs: number }
  | { status: "matched"; battleId: string }
  | { status: "timeout" };

export interface BattlePlayer {
  userId: string;
  username: string;
  avatar: string;
  isYou: boolean;
  language: Language | null;
  attempts: number;
  bestPassed: number;
  ratingBefore: number;
  ratingAfter: number | null;
  result: "win" | "loss" | "draw" | null;
  /** Lost the race but solved it during overtime (loss halved). */
  solvedInOvertime: boolean;
}

export interface BattleState {
  serverTime: string;
  battle: {
    id: string;
    status: "active" | "finished" | "cancelled";
    startsAt: string;
    endsAt: string;
    finishedAt: string | null;
    winnerId: string | null;
    finishReason: "solved" | "timeout_score" | "timeout_draw" | "forfeit" | null;
    /** False for a custom match, which never changes ratings. */
    isRated: boolean;
    /** The room code a custom match was played from. */
    roomCode: string | null;
    /** When the winner solved it. Set once someone has passed every test. */
    firstSolvedAt: string | null;
    /** End of the other player's overtime (2 min, never past endsAt). */
    overtimeEndsAt: string | null;
    overtimeOutcome: "solved" | "gave_up" | "timeout" | null;
    /** The overtime player's rating change if they do not solve it (negative; 0 when unrated). */
    overtimeFullDelta: number | null;
    /** Set when this battle is a rematch of another. */
    rematchOf: string | null;
    /** Results between the two players in the last 24 hours (from your side). */
    series: Series;
  };
  players: BattlePlayer[];
  totalTests: number;
  problem: {
    title: string;
    difficulty: "easy" | "medium" | "hard";
    statementMd: string;
    samples: { input: string; output: string; explanation?: string }[];
    timeLimitMs: number;
    memoryLimitKb: number;
  } | null;
}

export interface RunResult {
  verdict: Verdict;
  passed: number;
  total: number;
  compileOutput?: string;
  cases: { input: string; expected: string; actual: string; status: Verdict }[];
}

export interface SubmitResult {
  submissionId: string;
  verdict: Verdict;
  passed: number;
  total: number;
  compileOutput?: string;
  battleFinished: boolean;
}

export interface RoomPlayer {
  userId: string;
  username: string;
  avatar: string;
  rating: number;
}

/** A custom match room, as one of its players (or someone about to join) sees it. */
export interface Room {
  serverTime: string;
  id: string;
  code: string;
  status: "open" | "started" | "closed" | "expired";
  difficulty: RoomDifficulty;
  minutes: RoomMinutes;
  expiresAt: string;
  battleId: string | null;
  isHost: boolean;
  host: RoomPlayer;
  guest: RoomPlayer | null;
}

export interface RecentRoom {
  opponent: RoomPlayer;
  difficulty: RoomDifficulty;
  minutes: RoomMinutes;
  playedAt: string;
}

export interface Series {
  you: number;
  them: number;
  draws: number;
}

/** The rematch offer after a finished battle, as one of its players sees it. */
export interface Rematch {
  serverTime: string;
  status: "none" | "pending" | "accepted" | "declined" | "expired" | "cancelled";
  requestedByYou: boolean;
  cancelReason: "withdrawn" | "busy" | null;
  /** The rematch battle, once both said yes. */
  newBattleId: string | null;
  /** Rematch can be asked until 60 seconds after the battle ended. */
  windowEndsAt: string;
  /** Whether a rematch would count for rating. */
  rated: boolean;
  series: Series;
}

export interface HeadToHead {
  wins: number;
  losses: number;
  draws: number;
}

export interface Friend extends RoomPlayer {
  friendsSince: string;
  /** In a battle right now: cannot be challenged. */
  inBattle: boolean;
  /** Your record against this friend. */
  headToHead: HeadToHead;
}

export interface FriendList {
  friends: Friend[];
  /** Requests waiting for your answer. */
  incoming: (RoomPlayer & { sentAt: string })[];
  /** Requests you sent that are not answered yet. */
  outgoing: (RoomPlayer & { sentAt: string })[];
}

export type FriendStatusKind = "none" | "outgoing" | "incoming" | "friends" | "self";

export interface FoundPlayer extends RoomPlayer {
  status: Exclude<FriendStatusKind, "self">;
}

export interface FriendStatus {
  userId: string;
  status: FriendStatusKind;
  inBattle: boolean;
  headToHead: HeadToHead;
}

export interface Challenge {
  serverTime: string;
  id: string;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  cancelReason: "withdrawn" | "challenger_busy" | "challenged_busy" | "unfriended" | null;
  difficulty: RoomDifficulty;
  minutes: RoomMinutes;
  expiresAt: string;
  battleId: string | null;
  isChallenger: boolean;
  challenger: RoomPlayer;
  challenged: RoomPlayer;
}

export interface Notifications {
  serverTime: string;
  friendRequests: number;
  incomingChallenges: Challenge[];
  /** Your latest challenge: waiting, or answered in the last minute. */
  outgoingChallenge: Challenge | null;
}

export interface ApiClient {
  getFriends(): Promise<FriendList>;
  /** Up to 8 players whose username contains `query` (3+ letters), with how you stand with each. */
  searchPlayers(query: string): Promise<FoundPlayer[]>;
  getFriendStatus(username: string): Promise<FriendStatus>;
  sendFriendRequest(username: string): Promise<{ status: FriendStatusKind; userId: string }>;
  respondFriendRequest(
    userId: string,
    accept: boolean,
  ): Promise<{ status: FriendStatusKind; userId: string }>;
  removeFriend(userId: string): Promise<void>;
  sendChallenge(
    userId: string,
    difficulty: RoomDifficulty,
    minutes: RoomMinutes,
  ): Promise<Challenge>;
  respondChallenge(challengeId: string, accept: boolean): Promise<Challenge>;
  cancelChallenge(challengeId: string): Promise<Challenge>;
  getNotifications(): Promise<Notifications>;
  createRoom(difficulty: RoomDifficulty, minutes: RoomMinutes): Promise<Room>;
  getCurrentRoom(): Promise<Room | null>;
  /** Your last 3 played rooms (opponent and settings). */
  getRecentRooms(): Promise<RecentRoom[]>;
  getRoomByCode(code: string): Promise<Room>;
  joinRoom(code: string): Promise<Room>;
  getRoom(roomId: string): Promise<Room>;
  leaveRoom(roomId: string): Promise<void>;
  startRoom(roomId: string): Promise<Room>;
  getRematch(battleId: string): Promise<Rematch>;
  requestRematch(battleId: string): Promise<Rematch>;
  respondRematch(battleId: string, accept: boolean): Promise<Rematch>;
  cancelRematch(battleId: string): Promise<Rematch>;
  joinMatchmaking(): Promise<MatchmakingStatus>;
  cancelMatchmaking(): Promise<void>;
  getActiveBattle(): Promise<string | null>;
  getBattle(battleId: string): Promise<BattleState>;
  run(battleId: string, language: Language, code: string): Promise<RunResult>;
  submit(battleId: string, language: Language, code: string): Promise<SubmitResult>;
  forfeit(battleId: string): Promise<void>;
  setAvatar(avatar: string): Promise<void>;
  finalize(battleId: string): Promise<boolean>;
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current Supabase access token, or null when signed out. */
  getToken: () => Promise<string | null>;
  fetchFn?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = await options.getToken();
    if (!token) throw new ApiError("UNAUTHENTICATED", "Sign in to continue.", 401);

    let response: Response;
    try {
      response = await fetchFn(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError("NETWORK", "Could not reach the server. Check your connection.", 0);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // Handled below: a non-JSON body is only acceptable for errors.
    }

    if (!response.ok) {
      const error = (
        payload as { error?: { code?: string; message?: string; retryAfterMs?: number } }
      )?.error;
      throw new ApiError(
        error?.code ?? "INTERNAL",
        error?.message ?? "Something went wrong.",
        response.status,
        error?.retryAfterMs,
      );
    }
    if (payload === null) throw new ApiError("INTERNAL", "Something went wrong.", response.status);
    return payload as T;
  }

  return {
    getFriends: () => request("GET", "/api/friends"),
    searchPlayers: async (query) =>
      (
        await request<{ players: FoundPlayer[] }>(
          "GET",
          `/api/players/search?q=${encodeURIComponent(query)}`,
        )
      ).players,
    getFriendStatus: (username) =>
      request("GET", `/api/friends/status/${encodeURIComponent(username)}`),
    sendFriendRequest: (username) => request("POST", "/api/friends/request", { username }),
    respondFriendRequest: (userId, accept) =>
      request("POST", "/api/friends/respond", { userId, accept }),
    removeFriend: async (userId) => {
      await request("POST", "/api/friends/remove", { userId });
    },
    sendChallenge: (userId, difficulty, minutes) =>
      request("POST", "/api/challenges", { userId, difficulty, minutes }),
    respondChallenge: (id, accept) => request("POST", `/api/challenges/${id}/respond`, { accept }),
    cancelChallenge: (id) => request("POST", `/api/challenges/${id}/cancel`),
    getNotifications: () => request("GET", "/api/notifications"),
    createRoom: (difficulty, minutes) => request("POST", "/api/rooms", { difficulty, minutes }),
    getCurrentRoom: async () =>
      (await request<{ room: Room | null }>("GET", "/api/rooms/current")).room,
    getRecentRooms: async () =>
      (await request<{ rooms: RecentRoom[] }>("GET", "/api/rooms/recent")).rooms,
    getRoomByCode: (code) => request("GET", `/api/rooms/code/${encodeURIComponent(code)}`),
    joinRoom: (code) => request("POST", "/api/rooms/join", { code }),
    getRoom: (id) => request("GET", `/api/rooms/${id}`),
    leaveRoom: async (id) => {
      await request("POST", `/api/rooms/${id}/leave`);
    },
    startRoom: (id) => request("POST", `/api/rooms/${id}/start`),
    getRematch: (id) => request("GET", `/api/battles/${id}/rematch`),
    requestRematch: (id) => request("POST", `/api/battles/${id}/rematch`),
    respondRematch: (id, accept) =>
      request("POST", `/api/battles/${id}/rematch/respond`, { accept }),
    cancelRematch: (id) => request("POST", `/api/battles/${id}/rematch/cancel`),
    joinMatchmaking: () => request("POST", "/api/matchmaking/join"),
    cancelMatchmaking: async () => {
      await request("POST", "/api/matchmaking/cancel");
    },
    getActiveBattle: async () =>
      (await request<{ battleId: string | null }>("GET", "/api/battles/active")).battleId,
    getBattle: (id) => request("GET", `/api/battles/${id}`),
    run: (id, language, code) => request("POST", `/api/battles/${id}/run`, { language, code }),
    submit: (id, language, code) =>
      request("POST", `/api/battles/${id}/submit`, { language, code }),
    forfeit: async (id) => {
      await request("POST", `/api/battles/${id}/forfeit`);
    },
    setAvatar: async (avatar) => {
      await request("POST", "/api/profile/avatar", { avatar });
    },
    finalize: async (id) =>
      (await request<{ finished: boolean }>("POST", `/api/battles/${id}/finalize`)).finished,
  };
}
