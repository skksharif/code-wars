import { ROOM_DIFFICULTIES, ROOM_MINUTES, USERNAME_PATTERN } from "@code-wars/shared";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../app";
import { ApiError } from "../errors";

interface PlayerRow {
  user_id: string;
  username: string;
  avatar: string;
  rating: number;
}
interface Record3 {
  wins: number;
  losses: number;
  draws: number;
}
interface FriendRow extends PlayerRow {
  friends_since: string;
  in_battle: boolean;
  head_to_head: Record3;
}
interface ChallengeRow {
  server_time: string;
  id: string;
  status: string;
  cancel_reason: string | null;
  difficulty: string;
  duration_minutes: number;
  expires_at: string;
  battle_id: string | null;
  is_challenger: boolean;
  challenger: PlayerRow;
  challenged: PlayerRow;
}

const player = (p: PlayerRow) => ({
  userId: p.user_id,
  username: p.username,
  avatar: p.avatar,
  rating: p.rating,
});

const toChallenge = (c: ChallengeRow) => ({
  serverTime: c.server_time,
  id: c.id,
  status: c.status,
  cancelReason: c.cancel_reason,
  difficulty: c.difficulty,
  minutes: c.duration_minutes,
  expiresAt: c.expires_at,
  battleId: c.battle_id,
  isChallenger: c.is_challenger,
  challenger: player(c.challenger),
  challenged: player(c.challenged),
});

const userIdSchema = z.object({ userId: z.string().uuid() });
const usernameSchema = z.string().trim().regex(USERNAME_PATTERN);

async function body<T>(c: Context<AppContext>, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError("INVALID_INPUT");
  return parsed.data;
}

function challengeId(c: Context<AppContext>): string {
  const parsed = z.string().uuid().safeParse(c.req.param("id"));
  if (!parsed.success) throw new ApiError("INVALID_INPUT");
  return parsed.data;
}

export function registerFriendRoutes(app: Hono<AppContext>): void {
  // ---- friends --------------------------------------------------------------
  app.get("/api/friends", async (c) => {
    const data = await c.get("db").rpc<{
      friends: FriendRow[];
      incoming: (PlayerRow & { sent_at: string })[];
      outgoing: (PlayerRow & { sent_at: string })[];
    }>("get_friends", { p_user: c.get("userId") });
    return c.json({
      friends: data.friends.map((f) => ({
        ...player(f),
        friendsSince: f.friends_since,
        inBattle: f.in_battle,
        headToHead: f.head_to_head,
      })),
      incoming: data.incoming.map((p) => ({ ...player(p), sentAt: p.sent_at })),
      outgoing: data.outgoing.map((p) => ({ ...player(p), sentAt: p.sent_at })),
    });
  });

  // Suggestions while typing a username: 3 or more letters, at most 8 players.
  app.get("/api/players/search", async (c) => {
    const query = z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{3,20}$/)
      .safeParse(c.req.query("q") ?? "");
    if (!query.success) throw new ApiError("INVALID_INPUT", "Type 3 to 20 letters, digits or _.");
    const rows = await c.get("db").rpc<(PlayerRow & { status: string })[]>("search_players", {
      p_user: c.get("userId"),
      p_query: query.data,
    });
    return c.json({ players: rows.map((p) => ({ ...player(p), status: p.status })) });
  });

  app.get("/api/friends/status/:username", async (c) => {
    const username = usernameSchema.safeParse(c.req.param("username"));
    if (!username.success) throw new ApiError("PLAYER_NOT_FOUND");
    const s = await c.get("db").rpc<{
      user_id: string;
      status: string;
      in_battle?: boolean;
      head_to_head?: Record3;
    }>("get_friend_status", { p_user: c.get("userId"), p_username: username.data });
    return c.json({
      userId: s.user_id,
      status: s.status,
      inBattle: s.in_battle ?? false,
      headToHead: s.head_to_head ?? { wins: 0, losses: 0, draws: 0 },
    });
  });

  app.post("/api/friends/request", async (c) => {
    const { username } = await body(c, z.object({ username: usernameSchema }));
    const r = await c.get("db").rpc<{ status: string; user_id: string }>("send_friend_request", {
      p_user: c.get("userId"),
      p_username: username,
    });
    return c.json({ status: r.status, userId: r.user_id });
  });

  app.post("/api/friends/respond", async (c) => {
    const { userId, accept } = await body(c, userIdSchema.extend({ accept: z.boolean() }));
    const r = await c.get("db").rpc<{ status: string; user_id: string }>("respond_friend_request", {
      p_user: c.get("userId"),
      p_requester: userId,
      p_accept: accept,
    });
    return c.json({ status: r.status, userId: r.user_id });
  });

  // Unfriend, or withdraw a request you sent.
  app.post("/api/friends/remove", async (c) => {
    const { userId } = await body(c, userIdSchema);
    await c.get("db").rpc("remove_friend", { p_user: c.get("userId"), p_other: userId });
    return c.json({ status: "none", userId });
  });

  // ---- challenges -------------------------------------------------------------
  app.post("/api/challenges", async (c) => {
    const input = await body(
      c,
      userIdSchema.extend({
        difficulty: z.enum(ROOM_DIFFICULTIES),
        minutes: z.union([
          z.literal(ROOM_MINUTES[0]),
          z.literal(ROOM_MINUTES[1]),
          z.literal(ROOM_MINUTES[2]),
        ]),
      }),
    );
    const challenge = await c.get("db").rpc<ChallengeRow>("send_challenge", {
      p_user: c.get("userId"),
      p_friend: input.userId,
      p_difficulty: input.difficulty,
      p_minutes: input.minutes,
    });
    return c.json(toChallenge(challenge));
  });

  app.post("/api/challenges/:id/respond", async (c) => {
    const { accept } = await body(c, z.object({ accept: z.boolean() }));
    const challenge = await c.get("db").rpc<ChallengeRow>("respond_challenge", {
      p_user: c.get("userId"),
      p_challenge: challengeId(c),
      p_accept: accept,
    });
    return c.json(toChallenge(challenge));
  });

  app.post("/api/challenges/:id/cancel", async (c) => {
    const challenge = await c.get("db").rpc<ChallengeRow>("cancel_challenge", {
      p_user: c.get("userId"),
      p_challenge: challengeId(c),
    });
    return c.json(toChallenge(challenge));
  });

  // The bell and the challenge pop-ups: pending requests and challenges.
  app.get("/api/notifications", async (c) => {
    const n = await c.get("db").rpc<{
      server_time: string;
      friend_requests: number;
      incoming_challenges: ChallengeRow[];
      outgoing_challenge: ChallengeRow | null;
    }>("get_notifications", { p_user: c.get("userId") });
    return c.json({
      serverTime: n.server_time,
      friendRequests: n.friend_requests,
      incomingChallenges: n.incoming_challenges.map(toChallenge),
      outgoingChallenge: n.outgoing_challenge ? toChallenge(n.outgoing_challenge) : null,
    });
  });
}
