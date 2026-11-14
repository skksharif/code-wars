import { createApp } from "./app";
import { createSupabaseDb } from "./db";
import type { Env } from "./env";
import { runScheduledSweep } from "./routes/battles";

const app = createApp();

export default {
  fetch: app.fetch,

  // Cron Trigger (see wrangler.jsonc): runs every minute.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runScheduledSweep(createSupabaseDb(env)).catch((error) => {
        console.error("Scheduled sweep failed", error);
      }),
    );
  },
};
