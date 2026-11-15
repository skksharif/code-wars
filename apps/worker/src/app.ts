import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createSupabaseTokenVerifier, requireAuth, type TokenVerifier } from "./auth";
import { createSupabaseDb, type Db, type DbFactory } from "./db";
import { allowedOrigins, type Env } from "./env";
import { ApiError, toApiError } from "./errors";
import { createJudge, type JudgeFactory } from "./judge/index";
import { registerBattleRoutes } from "./routes/battles";
import { registerMatchmakingRoutes } from "./routes/matchmaking";
import { registerProfileRoutes } from "./routes/profile";
import { registerRoomRoutes } from "./routes/rooms";
import { registerSubmissionRoutes } from "./routes/submissions";

export interface AppContext {
  Bindings: Env;
  Variables: {
    /** Set by requireAuth from the verified token. */
    userId: string;
    db: Db;
  };
}

/** External dependencies, injectable so the app can be tested without a network. */
export interface AppDeps {
  verifyToken: TokenVerifier;
  createDb: DbFactory;
  createJudge: JudgeFactory;
}

export const defaultDeps: AppDeps = {
  verifyToken: createSupabaseTokenVerifier(),
  createDb: (env) => createSupabaseDb(env),
  createJudge,
};

/** Larger than the 64 KB code limit plus JSON overhead. */
const MAX_BODY_BYTES = 100 * 1024;

export function createApp(overrides: Partial<AppDeps> = {}): Hono<AppContext> {
  const deps: AppDeps = { ...defaultDeps, ...overrides };
  const app = new Hono<AppContext>();

  app.use(
    "/api/*",
    cors({
      origin: (origin, c) => (allowedOrigins(c.env as Env).includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
      maxAge: 600,
    }),
  );

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new ApiError("PAYLOAD_TOO_LARGE");
      },
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Everything below requires a signed-in user.
  app.use("/api/*", requireAuth(deps.verifyToken));
  app.use("/api/*", async (c, next) => {
    c.set("db", deps.createDb(c.env));
    await next();
  });

  registerMatchmakingRoutes(app);
  registerSubmissionRoutes(app, deps.createJudge);
  registerBattleRoutes(app);
  registerProfileRoutes(app);
  registerRoomRoutes(app);

  app.notFound((c) => c.json(new ApiError("NOT_FOUND").toBody(), 404));

  app.onError((error, c) => {
    const apiError = toApiError(error);
    if (apiError.code === "INTERNAL") {
      // Full detail goes to the Worker log only; the client gets a generic message.
      console.error("Unhandled error", error);
    }
    return c.json(apiError.toBody(), apiError.status as 400);
  });

  return app;
}
