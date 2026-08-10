import { LEDGER_SCHEMA_VERSION, type Ledger } from "./types.js";
import { isSafeFileName, isSafeIdentifier, isSafeRemoteTarget } from "./safety.js";

export function emptyLedger(planId: string, target: string, now = new Date()): Ledger {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    planId,
    target,
    updatedAt: now.toISOString(),
    items: {},
    runs: [],
  };
}

export function isLedger(value: unknown): value is Ledger {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<Ledger>;
  if (
    !(
      candidate.schemaVersion === LEDGER_SCHEMA_VERSION &&
      typeof candidate.planId === "string" &&
      isSafeIdentifier(candidate.planId) &&
      typeof candidate.target === "string" &&
      isSafeRemoteTarget(candidate.target) &&
      typeof candidate.updatedAt === "string" &&
      Number.isFinite(Date.parse(candidate.updatedAt)) &&
      candidate.items !== null &&
      typeof candidate.items === "object" &&
      Array.isArray(candidate.runs)
    )
  ) {
    return false;
  }
  const items = candidate.items as Record<string, unknown>;
  if (
    Object.entries(items).some(([key, value]) => {
      if (value === null || typeof value !== "object") return true;
      const item = value as Record<string, unknown>;
      return (
        key !== item.postId ||
        typeof item.postId !== "string" ||
        !isSafeIdentifier(item.postId) ||
        typeof item.finalName !== "string" ||
        !isSafeFileName(item.finalName) ||
        !["downloaded", "uploaded", "verified"].includes(String(item.status)) ||
        typeof item.size !== "number" ||
        !Number.isSafeInteger(item.size) ||
        item.size < 0 ||
        (item.localPath !== null && typeof item.localPath !== "string") ||
        typeof item.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(item.updatedAt))
      );
    })
  ) {
    return false;
  }
  return candidate.runs.every((value) => {
    if (value === null || typeof value !== "object") return false;
    const run = value as unknown as Record<string, unknown>;
    return (
      typeof run.planDigest === "string" &&
      /^[a-f0-9]{64}$/.test(run.planDigest) &&
      typeof run.startedAt === "string" &&
      Number.isFinite(Date.parse(run.startedAt)) &&
      (run.completedAt === null ||
        (typeof run.completedAt === "string" && Number.isFinite(Date.parse(run.completedAt)))) &&
      typeof run.completedItems === "number" &&
      Number.isSafeInteger(run.completedItems) &&
      run.completedItems >= 0 &&
      ["running", "completed", "failed"].includes(String(run.status)) &&
      (run.errorCode === undefined || typeof run.errorCode === "string")
    );
  });
}
