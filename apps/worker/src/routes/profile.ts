import { AVATARS } from "@code-wars/shared";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../app";
import { ApiError } from "../errors";

const avatarSchema = z.object({ avatar: z.enum(AVATARS) });

export function registerProfileRoutes(app: Hono<AppContext>): void {
  // Players change only their own avatar: the user id comes from the token.
  app.post("/api/profile/avatar", async (c) => {
    const body = avatarSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new ApiError("INVALID_INPUT");
    const avatar = await c.get("db").rpc<string>("set_avatar", {
      p_user: c.get("userId"),
      p_avatar: body.data.avatar,
    });
    return c.json({ avatar });
  });
}
