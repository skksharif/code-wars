/** Values approved in docs/requirements.md. The database enforces the same numbers. */

export const LANGUAGES = ["python", "java", "cpp", "javascript"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  python: "Python 3.12",
  java: "Java 17",
  cpp: "C++ (GCC 14)",
  javascript: "JavaScript (Node 22)",
};

export const VERDICTS = [
  "accepted",
  "wrong_answer",
  "compile_error",
  "runtime_error",
  "time_limit",
  "memory_limit",
  "internal_error",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const BATTLE_STATUSES = ["active", "finished", "cancelled"] as const;
export type BattleStatus = (typeof BATTLE_STATUSES)[number];

export const FINISH_REASONS = ["solved", "timeout_score", "timeout_draw", "forfeit"] as const;
export type FinishReason = (typeof FINISH_REASONS)[number];

export const SUBMISSION_KINDS = ["run", "submit"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

export const LIMITS = {
  initialRating: 1200,
  eloK: 32,
  battleDurationMs: 15 * 60 * 1000,
  getReadyMs: 10 * 1000,
  submitCooldownMs: 10 * 1000,
  runCooldownMs: 5 * 1000,
  maxCodeBytes: 64 * 1024,
  matchWindowStart: 100,
  matchWindowStep: 50,
  matchWindowStepMs: 10 * 1000,
  queueTimeoutMs: 60 * 1000,
  heartbeatIntervalMs: 5 * 1000,
  heartbeatStaleMs: 15 * 1000,
  usernameMin: 3,
  usernameMax: 20,
} as const;

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** Rating window a queued player accepts after waiting `waitedMs`. */
export function matchWindow(waitedMs: number): number {
  const steps = Math.floor(Math.max(0, waitedMs) / LIMITS.matchWindowStepMs);
  return LIMITS.matchWindowStart + steps * LIMITS.matchWindowStep;
}

/** The six built-in avatars. Ids match the database check constraint. */
export const AVATARS = ["cipher", "kernel", "vector", "nova", "pixel", "echo"] as const;
export type AvatarId = (typeof AVATARS)[number];

export const AVATAR_INFO: Record<
  AvatarId,
  { name: string; group: "male" | "female"; look: string }
> = {
  cipher: { name: "Cipher", group: "male", look: "short spiky hair and headphones" },
  kernel: { name: "Kernel", group: "male", look: "a beanie and a beard" },
  vector: { name: "Vector", group: "male", look: "swept hair and square glasses" },
  nova: { name: "Nova", group: "female", look: "long hair and a light visor" },
  pixel: { name: "Pixel", group: "female", look: "two hair buns and a headset" },
  echo: { name: "Echo", group: "female", look: "a bob haircut and round glasses" },
};

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && (AVATARS as readonly string[]).includes(value);
}
