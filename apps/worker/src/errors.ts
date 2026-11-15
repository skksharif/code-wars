/** Error codes the API returns. See docs/api-design.md. */
export const ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  NOT_PARTICIPANT: 403,
  NOT_HOST: 403,
  NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  BATTLE_NOT_ACTIVE: 409,
  BATTLE_NOT_STARTED: 409,
  SUBMISSION_IN_FLIGHT: 409,
  ALREADY_IN_BATTLE: 409,
  ROOM_FULL: 409,
  ROOM_OWN: 409,
  ROOM_NOT_OPEN: 409,
  ROOM_NOT_READY: 409,
  ROOM_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  COOLDOWN: 429,
  JUDGE_QUOTA_EXHAUSTED: 429,
  INTERNAL: 500,
  JUDGE_UNAVAILABLE: 502,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  INVALID_INPUT: "The request is not valid.",
  UNAUTHENTICATED: "Sign in to continue.",
  NOT_PARTICIPANT: "You are not a player in this battle.",
  NOT_HOST: "Only the host can start the battle.",
  NOT_FOUND: "Not found.",
  ROOM_NOT_FOUND: "No room with that code. Check the code and try again.",
  BATTLE_NOT_ACTIVE: "This battle is no longer active.",
  BATTLE_NOT_STARTED: "This battle has not started yet.",
  SUBMISSION_IN_FLIGHT: "Your previous submission is still being judged.",
  ALREADY_IN_BATTLE: "Finish your current battle first.",
  ROOM_FULL: "This room is full.",
  ROOM_OWN: "That's your own room. Share the code with a friend.",
  ROOM_NOT_OPEN: "This room is closed.",
  ROOM_NOT_READY: "Wait for your friend to join first.",
  ROOM_EXPIRED: "This room has expired. Ask your friend for a new code.",
  PAYLOAD_TOO_LARGE: "The request is too large.",
  COOLDOWN: "Wait a moment before trying again.",
  JUDGE_QUOTA_EXHAUSTED: "The code judge has reached its daily limit. Try again tomorrow.",
  INTERNAL: "Something went wrong.",
  JUDGE_UNAVAILABLE: "The code judge is unavailable. Your submission was not counted.",
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(code: ErrorCode, message?: string, retryAfterMs?: number) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.retryAfterMs = retryAfterMs;
  }

  toBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
      },
    };
  }
}

/** A failure reported by the database, for example a code raised by a function. */
export class DbError extends Error {
  readonly details?: string;

  constructor(message: string, details?: string) {
    super(message);
    this.details = details;
  }
}

function isErrorCode(value: string): value is ErrorCode {
  return value in ERROR_STATUS;
}

/**
 * Turns anything thrown into an ApiError. Database functions raise a known code
 * as the message; anything unrecognised becomes a generic INTERNAL error so
 * internal details never reach the client.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DbError && isErrorCode(error.message) && error.message !== "INTERNAL") {
    if (error.message === "COOLDOWN") {
      const ms = Number(error.details);
      const retryAfterMs = Number.isFinite(ms) && ms > 0 ? ms : undefined;
      const seconds = retryAfterMs ? Math.ceil(retryAfterMs / 1000) : undefined;
      return new ApiError(
        "COOLDOWN",
        seconds ? `Wait ${seconds} seconds before trying again.` : undefined,
        retryAfterMs,
      );
    }
    return new ApiError(error.message);
  }
  return new ApiError("INTERNAL");
}
