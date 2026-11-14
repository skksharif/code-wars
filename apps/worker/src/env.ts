/** Bindings available to the Worker. Secrets are set with `wrangler secret put`. */
export interface Env {
  SUPABASE_URL: string;
  /** SECRET. Full database access; never sent to the browser or logged. */
  SUPABASE_SERVICE_ROLE_KEY: string;
  JUDGE_PROVIDER?: string;
  JUDGE0_API_URL?: string;
  JUDGE0_API_HOST?: string;
  /** SECRET. */
  JUDGE0_API_KEY?: string;
  JUDGE_DAILY_LIMIT?: string;
  /** Comma-separated list of origins allowed to call the API from a browser. */
  ALLOWED_ORIGINS?: string;
}

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
