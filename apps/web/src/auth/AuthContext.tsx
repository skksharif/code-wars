import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthService, AuthUser, Profile } from "../lib/authService";

export interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  user: AuthUser | null;
  profile: Profile | null;
  service: AuthService;
  /** Reloads rating and record, for example after a battle. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ service, children }: { service: AuthService; children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let active = true;
    const apply = (next: AuthUser | null) => {
      if (!active) return;
      setUser(next);
      setStatus(next ? "signedIn" : "signedOut");
      if (!next) setProfile(null);
    };
    service.getUser().then(apply, () => apply(null));
    const unsubscribe = service.onChange(apply);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [service]);

  const userId = user?.id;
  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    try {
      setProfile(await service.getProfile(userId));
    } catch {
      // The nav simply shows no rating; nothing else depends on this.
    }
  }, [service, userId]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  return (
    <AuthContext.Provider value={{ status, user, profile, service, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
