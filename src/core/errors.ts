export type ErrorCode =
  | "USAGE_ERROR"
  | "DEPENDENCY_MISSING"
  | "AUTH_REQUIRED"
  | "SOURCE_ERROR"
  | "REMOTE_ERROR"
  | "REMOTE_CONFLICT"
  | "PLAN_INVALID"
  | "PLAN_STALE"
  | "PLAN_NOT_CONFIRMED"
  | "DOWNLOAD_FAILED"
  | "VERIFY_FAILED"
  | "STATE_ERROR"
  | "INTERNAL_ERROR";

const exitCodes: Record<ErrorCode, number> = {
  USAGE_ERROR: 2,
  DEPENDENCY_MISSING: 3,
  AUTH_REQUIRED: 3,
  SOURCE_ERROR: 4,
  REMOTE_ERROR: 5,
  REMOTE_CONFLICT: 6,
  PLAN_INVALID: 7,
  PLAN_STALE: 7,
  PLAN_NOT_CONFIRMED: 7,
  DOWNLOAD_FAILED: 8,
  VERIFY_FAILED: 9,
  STATE_ERROR: 10,
  INTERNAL_ERROR: 1,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.exitCode = exitCodes[code];
    this.details = details;
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Error) {
    return new AppError("INTERNAL_ERROR", error.message);
  }
  return new AppError("INTERNAL_ERROR", String(error));
}
