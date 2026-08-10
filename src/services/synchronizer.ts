import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { AppError, asAppError } from "../core/errors.js";
import { assertCleanupConfirmed } from "../core/cleanup-plan.js";
import { assertPlanConfirmed, assertPlanExecutable, assertRemoteSnapshot } from "../core/plan.js";
import type {
  CleanupPlan,
  Ledger,
  PlanItem,
  RemoteFile,
  RunRecord,
  SyncPlan,
} from "../core/types.js";
import type { MediaPort, SourcePort, StoragePort } from "../ports.js";
import type { StateStore } from "../state/json-store.js";

export interface SyncResult {
  planDigest: string;
  renamed: number;
  downloaded: number;
  uploaded: number;
  verified: number;
}

interface PreparedTransfer {
  item: PlanItem;
  path: string;
  size: number;
  downloaded: boolean;
}

export async function executeSync(input: {
  plan: SyncPlan;
  confirmation: string;
  jobs: number;
  workDir: string;
  source: SourcePort;
  storage: StoragePort;
  media: MediaPort;
  state: StateStore;
}): Promise<SyncResult> {
  assertPlanExecutable(input.plan, input.confirmation);
  if (!Number.isInteger(input.jobs) || input.jobs < 1 || input.jobs > 16) {
    throw new AppError("USAGE_ERROR", "--jobs must be an integer from 1 to 16.");
  }

  const remote = await input.storage.listFiles(input.plan.target);
  assertRemoteSnapshot(input.plan, remote);
  const expectedRemote = new Map(remote.map((file) => [file.name, file.size]));
  const ledger = await input.state.loadLedger(input.plan.planId, input.plan.target);
  const run: RunRecord = {
    planDigest: input.plan.digest,
    startedAt: new Date().toISOString(),
    completedAt: null,
    completedItems: 0,
    status: "running",
  };
  ledger.runs.push(run);
  await input.state.saveLedger(ledger);

  let renamed = 0;
  let downloaded = 0;
  let uploaded = 0;
  try {
    for (const item of input.plan.items.filter((candidate) => candidate.action === "rename")) {
      await assertExpectedRemote(input.storage, input.plan.target, expectedRemote);
      if (
        !item.currentRemoteName ||
        !expectedRemote.has(item.currentRemoteName) ||
        expectedRemote.has(item.finalName)
      ) {
        throw new AppError(
          "PLAN_STALE",
          `Remote rename preconditions changed for post ${item.postId}.`,
        );
      }
      await input.storage.move(input.plan.target, item.currentRemoteName, item.finalName);
      const size = expectedRemote.get(item.currentRemoteName) ?? 0;
      expectedRemote.delete(item.currentRemoteName);
      expectedRemote.set(item.finalName, size);
      updateLedgerItem(ledger, item, "verified", size, verifiedLocalPath(item, size));
      renamed += 1;
      run.completedItems += 1;
      await input.state.saveLedger(ledger);
    }

    for (const item of input.plan.items.filter((candidate) => candidate.action === "skip")) {
      const size = item.remoteSize ?? 0;
      updateLedgerItem(ledger, item, "verified", size, verifiedLocalPath(item, size));
      run.completedItems += 1;
    }
    await input.state.saveLedger(ledger);

    const transfers = input.plan.items.filter((candidate) => candidate.action === "transfer");
    const settled = await mapLimitSettled(transfers, input.jobs, async (item) => {
      const path =
        item.localPath ?? safeWorkPath(input.workDir, input.plan.planId, item.originalName);
      if (item.localPath) {
        assertInsideWorkDir(path, input.workDir);
        await assertRealPathInsideWorkDir(path, input.workDir);
      } else {
        await prepareDownloadPath(path, input.workDir);
      }
      const probe = item.downloadRequired
        ? await input.media.download(await input.source.getVideoSource(item.postId), path)
        : await input.media.probe(path);
      if (item.localSize !== null && !item.downloadRequired && probe.size !== item.localSize) {
        throw new AppError("PLAN_STALE", `Local file changed after planning: ${item.localPath}`);
      }
      return { item, path, size: probe.size, downloaded: item.downloadRequired };
    });
    const prepared: PreparedTransfer[] = [];
    let preparationError: unknown = null;
    for (const result of settled) {
      if (result.status === "fulfilled") {
        prepared.push(result.value);
        updateLedgerItem(
          ledger,
          result.value.item,
          "downloaded",
          result.value.size,
          result.value.path,
        );
        if (result.value.downloaded) {
          downloaded += 1;
        }
      } else if (preparationError === null) {
        preparationError = result.reason;
      }
    }
    await input.state.saveLedger(ledger);
    if (preparationError !== null) {
      throw preparationError;
    }

    for (const transfer of prepared) {
      await assertExpectedRemote(input.storage, input.plan.target, expectedRemote);
      if (expectedRemote.has(transfer.item.finalName)) {
        throw new AppError(
          "PLAN_STALE",
          `Remote destination now exists: ${transfer.item.finalName}`,
        );
      }
      await input.storage.upload(input.plan.target, transfer.path, transfer.item.finalName);
      expectedRemote.set(transfer.item.finalName, transfer.size);
      updateLedgerItem(ledger, transfer.item, "uploaded", transfer.size, transfer.path);
      uploaded += 1;
      await input.state.saveLedger(ledger);
    }

    const finalRemote = await input.storage.listFiles(input.plan.target);
    assertExpectedEntries(finalRemote, input.plan.items, ledger);
    for (const item of input.plan.items) {
      const ledgerItem = ledger.items[item.postId];
      if (ledgerItem) {
        ledgerItem.status = "verified";
        ledgerItem.updatedAt = new Date().toISOString();
      }
    }
    run.completedAt = new Date().toISOString();
    run.status = "completed";
    run.completedItems = input.plan.items.length;
    await input.state.saveLedger(ledger);
    return {
      planDigest: input.plan.digest,
      renamed,
      downloaded,
      uploaded,
      verified: input.plan.items.length,
    };
  } catch (error) {
    const appError = asAppError(error);
    run.completedAt = new Date().toISOString();
    run.status = "failed";
    run.errorCode = appError.code;
    await input.state.saveLedger(ledger);
    throw appError;
  }
}

export async function cleanupVerified(input: {
  plan: CleanupPlan;
  confirmation: string;
  workDir: string;
  state: StateStore;
}): Promise<{ deleted: string[]; retained: string[] }> {
  assertCleanupConfirmed(input.plan, input.confirmation);
  const ledger = await input.state.loadLedger(input.plan.planId, input.plan.target);
  const deleted: string[] = [];
  const retained: string[] = [];
  const validated: Array<{ postId: string; path: string; size: number }> = [];
  for (const item of input.plan.items) {
    const record = ledger.items[item.postId];
    if (
      !record?.localPath ||
      record.status !== "verified" ||
      record.localPath !== item.path ||
      record.size !== item.size
    ) {
      throw new AppError("PLAN_STALE", `Cleanup ledger state changed for post ${item.postId}.`);
    }
    assertInsideWorkDir(item.path, input.workDir);
    await assertRealPathInsideWorkDir(item.path, input.workDir);
    const metadata = await lstat(item.path).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size !== item.size) {
      throw new AppError("PLAN_STALE", `Cleanup target changed after planning: ${item.path}`);
    }
    validated.push({ postId: item.postId, path: item.path, size: item.size });
  }
  for (const item of validated) {
    await assertRealPathInsideWorkDir(item.path, input.workDir);
    const metadata = await lstat(item.path).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size !== item.size) {
      throw new AppError("PLAN_STALE", `Cleanup target changed before deletion: ${item.path}`);
    }
    await rm(item.path, { force: true });
    deleted.push(item.path);
    const record = ledger.items[item.postId];
    if (record) {
      record.localPath = null;
      record.updatedAt = new Date().toISOString();
    }
    await input.state.saveLedger(ledger);
  }
  return { deleted, retained };
}

export async function rollbackRenames(input: {
  plan: SyncPlan;
  confirmation: string;
  storage: StoragePort;
  state: StateStore;
}): Promise<{ rolledBack: number; alreadyRolledBack: number }> {
  assertPlanConfirmed(input.plan, input.confirmation);
  const ledger = await input.state.loadLedger(input.plan.planId, input.plan.target);
  let rolledBack = 0;
  let alreadyRolledBack = 0;
  for (const item of input.plan.items.filter((candidate) => candidate.action === "rename")) {
    const files = new Map(
      (await input.storage.listFiles(input.plan.target)).map((file) => [file.name, file.size]),
    );
    const hasFinal = files.has(item.finalName);
    const hasOriginal = files.has(item.originalName);
    if (hasFinal && hasOriginal) {
      throw new AppError("REMOTE_CONFLICT", `Both rollback paths exist for post ${item.postId}.`);
    }
    if (!hasFinal && hasOriginal) {
      alreadyRolledBack += 1;
      delete ledger.items[item.postId];
      continue;
    }
    if (!hasFinal) {
      throw new AppError("REMOTE_CONFLICT", `Rollback source is missing: ${item.finalName}`);
    }
    const record = ledger.items[item.postId];
    if (record?.finalName !== item.finalName || record.status !== "verified") {
      throw new AppError(
        "PLAN_INVALID",
        `No completed rename record exists for rollback post ${item.postId}.`,
      );
    }
    await input.storage.move(input.plan.target, item.finalName, item.originalName);
    delete ledger.items[item.postId];
    rolledBack += 1;
    await input.state.saveLedger(ledger);
  }
  await input.state.saveLedger(ledger);
  return { rolledBack, alreadyRolledBack };
}

export function verifyExpectedRemote(
  plan: SyncPlan,
  files: RemoteFile[],
  ledger: Ledger,
): {
  ok: boolean;
  verified: number;
  missing: string[];
  sizeMismatches: string[];
  unmanaged: string[];
} {
  const expected = new Set(plan.items.map((item) => item.finalName));
  const remote = new Map(files.map((file) => [file.name, file.size]));
  const missing: string[] = [];
  const sizeMismatches: string[] = [];
  let verified = 0;
  for (const item of plan.items) {
    const size = remote.get(item.finalName);
    if (size === undefined) {
      missing.push(item.finalName);
      continue;
    }
    const knownSize = ledger.items[item.postId]?.size;
    if (knownSize !== undefined && knownSize !== size) {
      sizeMismatches.push(item.finalName);
      continue;
    }
    verified += 1;
  }
  const unmanaged = files.filter((file) => !expected.has(file.name)).map((file) => file.name);
  return {
    ok: missing.length === 0 && sizeMismatches.length === 0,
    verified,
    missing,
    sizeMismatches,
    unmanaged,
  };
}

function updateLedgerItem(
  ledger: Ledger,
  item: PlanItem,
  status: "downloaded" | "uploaded" | "verified",
  size: number,
  localPath: string | null,
): void {
  ledger.items[item.postId] = {
    postId: item.postId,
    finalName: item.finalName,
    status,
    size,
    localPath,
    updatedAt: new Date().toISOString(),
  };
}

function verifiedLocalPath(item: PlanItem, verifiedSize: number): string | null {
  return item.localPath !== null && item.localSize === verifiedSize ? item.localPath : null;
}

async function assertExpectedRemote(
  storage: StoragePort,
  target: string,
  expected: Map<string, number>,
): Promise<void> {
  const actual = await storage.listFiles(target);
  const actualMap = new Map(actual.map((file) => [file.name, file.size]));
  if (
    actualMap.size !== expected.size ||
    [...expected].some(([name, size]) => actualMap.get(name) !== size)
  ) {
    throw new AppError(
      "PLAN_STALE",
      "The remote changed during synchronization; execution stopped.",
    );
  }
}

function assertExpectedEntries(files: RemoteFile[], items: PlanItem[], ledger: Ledger): void {
  const remote = new Map(files.map((file) => [file.name, file.size]));
  const failures = items.filter((item) => {
    const expectedSize = ledger.items[item.postId]?.size;
    return (
      !remote.has(item.finalName) ||
      (expectedSize !== undefined && remote.get(item.finalName) !== expectedSize)
    );
  });
  if (failures.length > 0) {
    throw new AppError("VERIFY_FAILED", "Remote verification failed after synchronization.", {
      postIds: failures.map((item) => item.postId),
    });
  }
}

function safeWorkPath(workDir: string, planId: string, name: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(planId) || name.includes("/") || name.includes("\\")) {
    throw new AppError("PLAN_INVALID", "The plan contains an unsafe local path component.");
  }
  const path = resolve(workDir, planId, name);
  assertInsideWorkDir(path, workDir);
  return path;
}

function assertInsideWorkDir(path: string, workDir: string): void {
  const resolvedWorkDir = resolve(workDir);
  const resolvedPath = resolve(path);
  const child = relative(resolvedWorkDir, resolvedPath);
  if (child === "" || child.startsWith("..") || isAbsolute(child)) {
    throw new AppError("PLAN_INVALID", "A local media path is outside --work-dir.", { path });
  }
}

async function prepareDownloadPath(path: string, workDir: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const [realParent, realWorkDir] = await Promise.all([realpath(dirname(path)), realpath(workDir)]);
  assertResolvedInside(realParent, realWorkDir, path);
}

async function assertRealPathInsideWorkDir(path: string, workDir: string): Promise<void> {
  const [realTarget, realWorkDir] = await Promise.all([realpath(path), realpath(workDir)]);
  assertResolvedInside(realTarget, realWorkDir, path);
}

function assertResolvedInside(path: string, workDir: string, originalPath: string): void {
  const child = relative(workDir, path);
  if (child === "" || child.startsWith("..") || isAbsolute(child)) {
    throw new AppError("PLAN_INVALID", "A local media path resolves outside --work-dir.", {
      path: originalPath,
    });
  }
}

async function mapLimitSettled<T, U>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<U>,
): Promise<PromiseSettledResult<U>[]> {
  const results = new Array<PromiseSettledResult<U>>(values.length);
  let index = 0;
  async function runWorker(): Promise<void> {
    while (index < values.length) {
      const current = index;
      index += 1;
      const value = values[current];
      if (value === undefined) {
        continue;
      }
      try {
        results[current] = { status: "fulfilled", value: await worker(value) };
      } catch (reason) {
        results[current] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, runWorker));
  return results;
}
