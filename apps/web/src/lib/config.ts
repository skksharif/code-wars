import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
}

/**
 * Reads the public build-time configuration. Returns null when it is missing
 * so the app can show a clear setup message instead of crashing.
 * Only public values belong here: the anon key is protected by database RLS.
 */
export function readConfig(env: Record<string, string | undefined>): AppConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim();
  if (!supabaseUrl || !supabaseAnonKey || !apiBaseUrl) return null;
  return { supabaseUrl, supabaseAnonKey, apiBaseUrl };
}

export function createSupabase(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey);
}
