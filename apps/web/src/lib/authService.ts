import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface Profile {
  username: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}

/** A message that is safe and useful to show to the user. */
export class AuthError extends Error {}

/**
 * Everything the app needs from the identity provider. The UI depends on this
 * interface, not on Supabase, so it can be tested with a fake.
 */
export interface AuthService {
  getUser(): Promise<AuthUser | null>;
  onChange(callback: (user: AuthUser | null) => void): () => void;
  getAccessToken(): Promise<string | null>;
  signUp(
    email: string,
    password: string,
    username: string,
  ): Promise<{ needsEmailConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  isUsernameAvailable(username: string): Promise<boolean>;
  getProfile(userId: string): Promise<Profile | null>;
}

function friendly(message: string | undefined, fallback: string): string {
  const text = (message ?? "").toLowerCase();
  if (text.includes("database error")) return "That username is taken or not allowed.";
  if (text.includes("already registered")) return "An account with this email already exists.";
  if (text.includes("invalid login")) return "Wrong email or password.";
  if (text.includes("password")) return "Use a password of at least 6 characters.";
  if (text.includes("rate limit")) return "Too many attempts. Wait a minute and try again.";
  return fallback;
}

export function createSupabaseAuthService(supabase: SupabaseClient): AuthService {
  const toUser = (user: { id: string; email?: string } | null | undefined): AuthUser | null =>
    user ? { id: user.id, email: user.email ?? null } : null;

  return {
    async getUser() {
      const { data } = await supabase.auth.getSession();
      return toUser(data.session?.user);
    },

    onChange(callback) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        callback(toUser(session?.user));
      });
      return () => data.subscription.unsubscribe();
    },

    async getAccessToken() {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },

    async signUp(email, password, username) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username },
          // Send the confirmation link back to this site. Supabase only honours it
          // if the address is in Authentication > URL Configuration > Redirect URLs;
          // otherwise it falls back to the project's Site URL.
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw new AuthError(friendly(error.message, "Could not create the account."));
      return { needsEmailConfirmation: !data.session };
    },

    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new AuthError(friendly(error.message, "Could not log in."));
    },

    async signOut() {
      await supabase.auth.signOut();
    },

    async isUsernameAvailable(username) {
      const { data, error } = await supabase.rpc("is_username_available", {
        p_username: username,
      });
      if (error) throw new AuthError("Could not check the username.");
      return data === true;
    },

    async getProfile(userId) {
      const { data } = await supabase
        .from("profiles")
        .select("username, rating, wins, losses, draws")
        .eq("id", userId)
        .maybeSingle();
      return (data as Profile | null) ?? null;
    },
  };
}
