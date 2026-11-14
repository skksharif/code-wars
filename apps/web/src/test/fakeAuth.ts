import { vi } from "vitest";
import type { AuthService, AuthUser, Profile } from "../lib/authService";

export interface FakeAuth extends AuthService {
  /** Simulates the identity provider reporting a sign-in or sign-out. */
  emit(user: AuthUser | null): void;
}

export const TEST_USER: AuthUser = { id: "user-1", email: "a@example.test" };
export const TEST_PROFILE: Profile = {
  username: "coder_42",
  rating: 1216,
  wins: 1,
  losses: 0,
  draws: 0,
};

export function createFakeAuth(initialUser: AuthUser | null = null): FakeAuth {
  let user = initialUser;
  const listeners = new Set<(user: AuthUser | null) => void>();
  const emit = (next: AuthUser | null) => {
    user = next;
    listeners.forEach((listener) => listener(next));
  };

  return {
    emit,
    getUser: vi.fn(async () => user),
    onChange: vi.fn((callback: (user: AuthUser | null) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }),
    getAccessToken: vi.fn(async () => (user ? "token" : null)),
    signUp: vi.fn(async () => {
      emit(TEST_USER);
      return { needsEmailConfirmation: false };
    }),
    signIn: vi.fn(async () => emit(TEST_USER)),
    signOut: vi.fn(async () => emit(null)),
    isUsernameAvailable: vi.fn(async () => true),
    getProfile: vi.fn(async () => TEST_PROFILE),
  };
}
