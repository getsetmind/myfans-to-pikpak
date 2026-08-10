import { AppError } from "./errors.js";
import { assignFinalNames } from "./filename.js";
import { sha256 } from "./canonical-json.js";
import { isSafeFileName, isSafeIdentifier, isSafeRemoteTarget } from "./safety.js";
import {
  PLAN_SCHEMA_VERSION,
  type PlanBuildInput,
  type PlanItem,
  type RemoteFile,
  type SyncPlan,
  type SyncPlanContent,
} from "./types.js";

const DEFAULT_VALIDITY_MS = 24 * 60 * 60 * 1000;

function remoteSnapshot(files: RemoteFile[]): string {
  return sha256(
    files
      .map((file) => ({ name: file.name.normalize("NFC"), size: file.size }))
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)),
  );
}

export function buildPlan(input: PlanBuildInput): SyncPlan {
  const now = input.now ?? new Date();
  const validityMs = input.validityMs ?? DEFAULT_VALIDITY_MS;
  const finalNames = assignFinalNames(input.posts);
  const remoteByName = new Map(input.remoteFiles.map((file) => [file.name, file]));
  const localByName = new Map(input.localFiles.map((file) => [file.name, file]));
  const matchedRemoteNames = new Set<string>();
  const errors: string[] = [];
  const items: PlanItem[] = [];

  if (new Set(input.posts.map((post) => post.id)).size !== input.posts.length) {
    throw new AppError("SOURCE_ERROR", "The source returned duplicate post IDs.");
  }
  if (input.posts.some((post) => !isSafeIdentifier(post.id))) {
    throw new AppError("SOURCE_ERROR", "The source returned an unsafe post ID.");
  }

  for (const post of input.posts) {
    const finalName = finalNames.get(post.id);
    if (!post.id || !finalName) {
      errors.push("A post has no usable ID or final filename.");
      continue;
    }

    const originalName = `${post.id}.mp4`;
    const originalRemote = remoteByName.get(originalName);
    const finalRemote = remoteByName.get(finalName);
    if (originalRemote && finalRemote && originalName !== finalName) {
      errors.push(`Both source and destination exist for post ${post.id}.`);
      continue;
    }

    const currentRemote = originalRemote ?? finalRemote ?? null;
    if (currentRemote) {
      matchedRemoteNames.add(currentRemote.name);
    }

    const ledgerItem = input.ledger.items[post.id];
    if (finalRemote && ledgerItem && ledgerItem.size !== finalRemote.size) {
      errors.push(`Remote size differs from the verified ledger for post ${post.id}.`);
      continue;
    }

    const local = localByName.get(originalName) ?? localByName.get(finalName) ?? null;
    let action: PlanItem["action"];
    if (finalRemote) {
      action = "skip";
    } else if (originalRemote) {
      action = "rename";
    } else {
      action = "transfer";
    }

    items.push({
      postId: post.id,
      originalName,
      finalName,
      publishedAt: post.publishedAt,
      action,
      currentRemoteName: currentRemote?.name ?? null,
      remoteSize: currentRemote?.size ?? null,
      localPath: local?.path ?? null,
      localSize: local?.size ?? null,
      downloadRequired: action === "transfer" && local === null,
    });
  }

  if (new Set(items.map((item) => item.finalName)).size !== items.length) {
    errors.push("The generated final filenames are not unique.");
  }

  if (errors.length > 0) {
    throw new AppError("REMOTE_CONFLICT", "The synchronization plan contains conflicts.", {
      errors,
    });
  }

  const extras = input.remoteFiles.filter((file) => !matchedRemoteNames.has(file.name));
  const warnings = extras.map((file) => `Unmanaged remote file: ${file.name}`);
  const collisionCount = countCollisions(items);
  const content: SyncPlanContent = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    planId: input.planId,
    target: input.target,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + validityMs).toISOString(),
    remoteSnapshotDigest: remoteSnapshot(input.remoteFiles),
    stats: {
      posts: items.length,
      skip: items.filter((item) => item.action === "skip").length,
      rename: items.filter((item) => item.action === "rename").length,
      transfer: items.filter((item) => item.action === "transfer").length,
      download: items.filter((item) => item.downloadRequired).length,
      collisions: collisionCount,
      remoteExtras: extras.length,
      knownTransferBytes: items
        .filter((item) => item.action === "transfer")
        .reduce((total, item) => total + (item.localSize ?? 0), 0),
    },
    items,
    warnings,
  };

  return { ...content, digest: sha256(content) };
}

function countCollisions(items: PlanItem[]): number {
  const bases = new Map<string, number>();
  for (const item of items) {
    const base = item.finalName.replace(/ \[[a-z0-9_-]{8,}\]\.mp4$/i, ".mp4");
    bases.set(base, (bases.get(base) ?? 0) + 1);
  }
  return [...bases.values()].filter((count) => count > 1).length;
}

export function assertValidPlan(value: unknown): asserts value is SyncPlan {
  if (value === null || typeof value !== "object") {
    throw new AppError("PLAN_INVALID", "The plan must be a JSON object.");
  }
  const plan = value as Partial<SyncPlan>;
  if (
    plan.schemaVersion !== PLAN_SCHEMA_VERSION ||
    typeof plan.planId !== "string" ||
    typeof plan.target !== "string" ||
    typeof plan.createdAt !== "string" ||
    typeof plan.expiresAt !== "string" ||
    typeof plan.remoteSnapshotDigest !== "string" ||
    typeof plan.digest !== "string" ||
    !Array.isArray(plan.items) ||
    !Array.isArray(plan.warnings) ||
    plan.stats === null ||
    typeof plan.stats !== "object"
  ) {
    throw new AppError("PLAN_INVALID", "The plan does not match schema version 1.");
  }

  const { digest, ...content } = plan as SyncPlan;
  if (sha256(content) !== digest) {
    throw new AppError("PLAN_INVALID", "The plan digest does not match its contents.");
  }

  const typed = plan as SyncPlan;
  if (
    !isSafeIdentifier(typed.planId) ||
    !isSafeRemoteTarget(typed.target) ||
    !isIsoDate(typed.createdAt) ||
    !isIsoDate(typed.expiresAt) ||
    Date.parse(typed.expiresAt) <= Date.parse(typed.createdAt) ||
    !isDigest(typed.remoteSnapshotDigest) ||
    !isDigest(typed.digest) ||
    !typed.warnings.every((warning) => typeof warning === "string") ||
    !typed.items.every(isValidItem) ||
    new Set(typed.items.map((item) => item.postId)).size !== typed.items.length ||
    new Set(typed.items.map((item) => item.finalName)).size !== typed.items.length ||
    !statsMatch(typed)
  ) {
    throw new AppError("PLAN_INVALID", "The plan contains invalid or inconsistent values.");
  }
}

export function assertPlanExecutable(plan: SyncPlan, confirmation: string, now = new Date()): void {
  assertPlanConfirmed(plan, confirmation);
  if (now.getTime() > Date.parse(plan.expiresAt)) {
    throw new AppError("PLAN_STALE", "The plan has expired. Generate and approve a new plan.");
  }
}

export function assertPlanConfirmed(plan: SyncPlan, confirmation: string): void {
  if (confirmation !== plan.digest) {
    throw new AppError("PLAN_NOT_CONFIRMED", "The confirmation digest does not match the plan.");
  }
}

export function assertRemoteSnapshot(plan: SyncPlan, files: RemoteFile[]): void {
  const actual = remoteSnapshot(files);
  if (actual !== plan.remoteSnapshotDigest) {
    throw new AppError(
      "PLAN_STALE",
      "The remote changed after the plan was generated. Generate a new plan.",
    );
  }
}

function isValidItem(item: PlanItem): boolean {
  if (
    !isSafeIdentifier(item.postId) ||
    item.originalName !== `${item.postId}.mp4` ||
    !isSafeFileName(item.originalName) ||
    !isSafeFileName(item.finalName) ||
    (item.publishedAt !== null && typeof item.publishedAt !== "string") ||
    !["skip", "rename", "transfer"].includes(item.action) ||
    typeof item.downloadRequired !== "boolean" ||
    (item.localPath === null) !== (item.localSize === null) ||
    (item.localPath !== null && typeof item.localPath !== "string") ||
    (item.localSize !== null && !isNonNegativeInteger(item.localSize)) ||
    (item.currentRemoteName === null) !== (item.remoteSize === null) ||
    (item.currentRemoteName !== null && !isSafeFileName(item.currentRemoteName)) ||
    (item.remoteSize !== null && !isNonNegativeInteger(item.remoteSize))
  ) {
    return false;
  }
  if (item.action === "skip") {
    return item.currentRemoteName === item.finalName && !item.downloadRequired;
  }
  if (item.action === "rename") {
    return (
      item.originalName !== item.finalName &&
      item.currentRemoteName === item.originalName &&
      !item.downloadRequired
    );
  }
  return (
    item.currentRemoteName === null &&
    item.remoteSize === null &&
    item.downloadRequired === (item.localPath === null)
  );
}

function statsMatch(plan: SyncPlan): boolean {
  const stats = plan.stats;
  if (Object.values(stats).some((value) => !isNonNegativeInteger(value))) {
    return false;
  }
  return (
    stats.posts === plan.items.length &&
    stats.skip === plan.items.filter((item) => item.action === "skip").length &&
    stats.rename === plan.items.filter((item) => item.action === "rename").length &&
    stats.transfer === plan.items.filter((item) => item.action === "transfer").length &&
    stats.download === plan.items.filter((item) => item.downloadRequired).length
  );
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function isIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
