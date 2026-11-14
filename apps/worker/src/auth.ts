import type { MiddlewareHandler } from "hono";
import type { AppContext } from "./app";
import type { Env } from "./env";
import { ApiError } from "./errors";

/** Returns the user id for a valid access token, or null if it is not valid. */
export type TokenVerifier = (token: string, env: Env) => Promise<string | null>;

/**
 * Asks Supabase Auth who the token belongs to. This honours sign-outs and
 * revoked sessions, which a purely local signature check would not.
 */
export function createSupabaseTokenVerifier(fetchFn: typeof fetch = fetch): TokenVerifier {
  return async (token, env) => {
    const response = await fetchFn(`${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error(`Auth service responded with ${response.status}`);
    const user = (await response.json()) as { id?: unknown };
    return typeof user.id === "string" && user.id.length > 0 ? user.id : null;
  };
}

/**
 * Requires a valid bearer token and stores the user id on the context.
 * The user id is only ever taken from the verified token, never from the request.
 */
export function requireAuth(verify: TokenVerifier): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw new ApiError("UNAUTHENTICATED");

    const userId = await verify(match[1]!, c.env);
    if (!userId) throw new ApiError("UNAUTHENTICATED");

    c.set("userId", userId);
    await next();
  };
}
