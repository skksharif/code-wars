import { ROOM_CODE_PATTERN, ROOM_DIFFICULTIES, ROOM_MINUTES } from "@code-wars/shared";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../app";
import { ApiError } from "../errors";

interface RoomPlayerRow {
  user_id: string;
  username: string;
  avatar: string;
  rating: number;
}

interface RoomRow {
  server_time: string;
  id: string;
  code: string;
  status: string;
  difficulty: string;
  duration_minutes: number;
  expires_at: string;
  battle_id: string | null;
  is_host: boolean;
  host: RoomPlayerRow;
  guest: RoomPlayerRow | null;
}

const player = (p: RoomPlayerRow) => ({
  userId: p.user_id,
  username: p.username,
  avatar: p.avatar,
  rating: p.rating,
});

/** The API's view of a room. Exported for the rematch route. */
export function toRoom(row: RoomRow) {
  return {
    serverTime: row.server_time,
    id: row.id,
    code: row.code,
    status: row.status,
    difficulty: row.difficulty,
    minutes: row.duration_minutes,
    expiresAt: row.expires_at,
    battleId: row.battle_id,
    isHost: row.is_host,
    host: player(row.host),
    guest: row.guest ? player(row.guest) : null,
  };
}

export type { RoomRow };

const createSchema = z.object({
  difficulty: z.enum(ROOM_DIFFICULTIES),
  minutes: z.union([
    z.literal(ROOM_MINUTES[0]),
    z.literal(ROOM_MINUTES[1]),
    z.literal(ROOM_MINUTES[2]),
  ]),
});

/** Codes are case-insensitive; anything else is rejected before the database. */
const codeSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(ROOM_CODE_PATTERN));

function roomId(c: Context<AppContext>): string {
  const parsed = z.string().uuid().safeParse(c.req.param("id"));
  if (!parsed.success) throw new ApiError("INVALID_INPUT");
  return parsed.data;
}

export function registerRoomRoutes(app: Hono<AppContext>): void {
  app.post("/api/rooms", async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new ApiError("INVALID_INPUT");
    const room = await c.get("db").rpc<RoomRow>("create_room", {
      p_user: c.get("userId"),
      p_difficulty: body.data.difficulty,
      p_minutes: body.data.minutes,
    });
    return c.json(toRoom(room));
  });

  // The open room the player is in, so the arena can bring them back to it.
  app.get("/api/rooms/current", async (c) => {
    const room = await c.get("db").rpc<RoomRow | null>("get_current_room", {
      p_user: c.get("userId"),
    });
    return c.json({ room: room ? toRoom(room) : null });
  });

  // Before joining: who hosts the room and its settings.
  app.get("/api/rooms/code/:code", async (c) => {
    const code = codeSchema.safeParse(c.req.param("code"));
    if (!code.success) throw new ApiError("INVALID_INPUT", "A room code has 6 letters and digits.");
    const room = await c.get("db").rpc<RoomRow>("get_room_by_code", {
      p_user: c.get("userId"),
      p_code: code.data,
    });
    return c.json(toRoom(room));
  });

  app.post("/api/rooms/join", async (c) => {
    const body = z.object({ code: codeSchema }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new ApiError("INVALID_INPUT", "A room code has 6 letters and digits.");
    const room = await c.get("db").rpc<RoomRow>("join_room", {
      p_user: c.get("userId"),
      p_code: body.data.code,
    });
    return c.json(toRoom(room));
  });

  app.get("/api/rooms/:id", async (c) => {
    const room = await c.get("db").rpc<RoomRow>("get_room", {
      p_user: c.get("userId"),
      p_room: roomId(c),
    });
    return c.json(toRoom(room));
  });

  app.post("/api/rooms/:id/leave", async (c) => {
    await c.get("db").rpc("leave_room", { p_user: c.get("userId"), p_room: roomId(c) });
    return c.json({ ok: true });
  });

  app.post("/api/rooms/:id/start", async (c) => {
    const room = await c.get("db").rpc<RoomRow>("start_room", {
      p_user: c.get("userId"),
      p_room: roomId(c),
    });
    return c.json(toRoom(room));
  });
}
