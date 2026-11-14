import type { Env } from "./env";
import { DbError } from "./errors";

/**
 * Trusted database access for the Worker, using the service role over
 * Supabase's REST interface. All state changes go through `rpc`, which calls
 * the Postgres functions that hold the transactional logic.
 */
export interface Db {
  rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T>;
  /** Read rows. `query` is a PostgREST query string, for example "id=eq.123&select=*". */
  select<T>(table: string, query: string): Promise<T[]>;
}

export type DbFactory = (env: Env) => Db;

interface PostgrestError {
  message?: string;
  details?: string | null;
}

export function createSupabaseDb(env: Env, fetchFn: typeof fetch = fetch): Db {
  const base = `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  async function parse<T>(response: Response): Promise<T> {
    if (response.ok) {
      return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
    }
    let body: PostgrestError = {};
    try {
      body = (await response.json()) as PostgrestError;
    } catch {
      // Non-JSON error body: fall through to a generic message.
    }
    throw new DbError(
      body.message ?? `Database request failed (${response.status})`,
      body.details ?? undefined,
    );
  }

  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
      const response = await fetchFn(`${base}/rpc/${fn}`, {
        method: "POST",
        headers,
        body: JSON.stringify(args),
      });
      return parse<T>(response);
    },

    async select<T>(table: string, query: string): Promise<T[]> {
      const response = await fetchFn(`${base}/${table}?${query}`, { method: "GET", headers });
      return parse<T[]>(response);
    },
  };
}
