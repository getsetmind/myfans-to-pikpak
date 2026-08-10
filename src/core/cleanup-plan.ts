import { sha256 } from "./canonical-json.js";
import { AppError } from "./errors.js";
import { isSafeIdentifier, isSafeRemoteTarget } from "./safety.js";
import {
  CLEANUP_SCHEMA_VERSION,
  type CleanupPlan,
  type CleanupPlanContent,
  type Ledger,
  type SyncPlan,
} from "./types.js";

export function buildCleanupPlan(
  syncPlan: SyncPlan,
  ledger: Ledger,
  now = new Date(),
): CleanupPlan {
  if (
    !ledger.runs.some((run) => run.planDigest === syncPlan.digest && run.status === "completed")
  ) {
    throw new AppError(
      "PLAN_INVALID",
      "Cleanup requires a completed run of the source synchronization plan.",
    );
  }
  const content: CleanupPlanContent = {
    schemaVersion: CLEANUP_SCHEMA_VERSION,
    kind: "cleanup",
    planId: syncPlan.planId,
    target: syncPlan.target,
    sourcePlanDigest: syncPlan.digest,
    createdAt: now.toISOString(),
    items: syncPlan.items.flatMap((item) => {
      const record = ledger.items[item.postId];
      return record?.status === "verified" && record.localPath && record.size > 0
        ? [{ postId: item.postId, path: record.localPath, size: record.size }]
        : [];
    }),
  };
  return { ...content, digest: sha256(content) };
}

export function assertValidCleanupPlan(value: unknown): asserts value is CleanupPlan {
  if (value === null || typeof value !== "object") {
    throw new AppError("PLAN_INVALID", "The cleanup plan must be a JSON object.");
  }
  const plan = value as Partial<CleanupPlan>;
  if (
    plan.schemaVersion !== CLEANUP_SCHEMA_VERSION ||
    plan.kind !== "cleanup" ||
    typeof plan.planId !== "string" ||
    typeof plan.target !== "string" ||
    typeof plan.sourcePlanDigest !== "string" ||
    typeof plan.createdAt !== "string" ||
    typeof plan.digest !== "string" ||
    !Array.isArray(plan.items) ||
    plan.items.some(
      (item) =>
        item === null ||
        typeof item !== "object" ||
        typeof item.postId !== "string" ||
        typeof item.path !== "string" ||
        !Number.isSafeInteger(item.size) ||
        item.size <= 0,
    ) ||
    !isSafeIdentifier(plan.planId) ||
    !isSafeRemoteTarget(plan.target) ||
    !/^[a-f0-9]{64}$/.test(plan.sourcePlanDigest) ||
    !Number.isFinite(Date.parse(plan.createdAt)) ||
    new Set(plan.items.map((item) => item.postId)).size !== plan.items.length
  ) {
    throw new AppError("PLAN_INVALID", "The cleanup plan does not match schema version 1.");
  }
  const { digest, ...content } = plan as CleanupPlan;
  if (sha256(content) !== digest) {
    throw new AppError("PLAN_INVALID", "The cleanup plan digest does not match its contents.");
  }
}

export function assertCleanupConfirmed(plan: CleanupPlan, confirmation: string): void {
  if (plan.digest !== confirmation) {
    throw new AppError(
      "PLAN_NOT_CONFIRMED",
      "The confirmation digest does not match the cleanup plan.",
    );
  }
}
