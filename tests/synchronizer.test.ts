import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCleanupPlan } from "../src/core/cleanup-plan.js";
import { emptyLedger } from "../src/core/ledger.js";
import { buildPlan } from "../src/core/plan.js";
import type { RemoteFile, VideoSource } from "../src/core/types.js";
import type { MediaPort, MediaProbe, SourcePort, StoragePort } from "../src/ports.js";
import { cleanupVerified, executeSync, rollbackRenames } from "../src/services/synchronizer.js";
import { StateStore } from "../src/state/json-store.js";
import { appPaths } from "../src/state/paths.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

class FakeStorage implements StoragePort {
  files = new Map<string, number>();
  operations: string[] = [];
  constructor(initial: RemoteFile[]) {
    for (const file of initial) this.files.set(file.name, file.size);
  }
  async listFiles(): Promise<RemoteFile[]> {
    return [...this.files].map(([name, size]) => ({ name, size }));
  }
  async move(_target: string, fromName: string, toName: string): Promise<void> {
    const size = this.files.get(fromName);
    if (size === undefined || this.files.has(toName)) throw new Error("unsafe move");
    this.files.delete(fromName);
    this.files.set(toName, size);
    this.operations.push(`move:${fromName}:${toName}`);
  }
  async upload(_target: string, _path: string, remoteName: string): Promise<void> {
    if (this.files.has(remoteName)) throw new Error("unsafe overwrite");
    this.files.set(remoteName, 20);
    this.operations.push(`upload:${remoteName}`);
  }
}

const source: SourcePort = {
  async listPlans() {
    return [];
  },
  async listPosts() {
    return [];
  },
  async getVideoSource(): Promise<VideoSource> {
    return { url: "fixture://video", kind: "mp4" };
  },
};
const media: MediaPort = {
  async download(): Promise<MediaProbe> {
    return { size: 20, durationSeconds: 2 };
  },
  async probe(): Promise<MediaProbe> {
    return { size: 20, durationSeconds: 2 };
  },
};

describe("synchronizer", () => {
  it("renames, uploads, verifies, cleans only via a separate plan, and only rolls back renames", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-sync-"));
    temporaryDirectories.push(root);
    const paths = appPaths({ stateDir: join(root, "state"), workDir: join(root, "work") });
    const state = new StateStore(paths);
    const localPath = join(paths.workDir, "plan-1", "post-0002.mp4");
    await mkdir(join(paths.workDir, "plan-1"), { recursive: true });
    await writeFile(localPath, Buffer.alloc(20));
    const storage = new FakeStorage([{ name: "post-0001.mp4", size: 10 }]);
    const plan = buildPlan({
      planId: "plan-1",
      target: "pikpak:Archive",
      posts: [
        { id: "post-0001", body: "One", publishedAt: null, thumbnailUrl: null },
        { id: "post-0002", body: "Two", publishedAt: null, thumbnailUrl: null },
      ],
      remoteFiles: await storage.listFiles(),
      localFiles: [{ name: "post-0002.mp4", path: localPath, size: 20 }],
      ledger: emptyLedger("plan-1", "pikpak:Archive"),
    });
    const result = await executeSync({
      plan,
      confirmation: plan.digest,
      jobs: 2,
      workDir: paths.workDir,
      source,
      storage,
      media,
      state,
    });
    expect(result).toMatchObject({ renamed: 1, uploaded: 1, verified: 2 });
    expect([...storage.files.keys()].sort()).toEqual(["One.mp4", "Two.mp4"]);

    const ledger = await state.loadLedger(plan.planId, plan.target);
    const cleanup = buildCleanupPlan(plan, ledger, new Date("2026-01-01T00:00:00Z"));
    expect(cleanup.items).toHaveLength(1);
    await cleanupVerified({
      plan: cleanup,
      confirmation: cleanup.digest,
      workDir: paths.workDir,
      state,
    });
    await expect(readFile(localPath)).rejects.toMatchObject({ code: "ENOENT" });

    const rolledBack = await rollbackRenames({ plan, confirmation: plan.digest, storage, state });
    expect(rolledBack.rolledBack).toBe(1);
    expect([...storage.files.keys()].sort()).toEqual(["Two.mp4", "post-0001.mp4"]);
  });

  it("does not delete a local file that changed after cleanup planning", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-cleanup-"));
    temporaryDirectories.push(root);
    const paths = appPaths({ stateDir: join(root, "state"), workDir: join(root, "work") });
    const state = new StateStore(paths);
    const localPath = join(paths.workDir, "plan-1", "post-0001.mp4");
    await mkdir(join(paths.workDir, "plan-1"), { recursive: true });
    await writeFile(localPath, Buffer.alloc(20));
    const plan = buildPlan({
      planId: "plan-1",
      target: "pikpak:Archive",
      posts: [{ id: "post-0001", body: "One", publishedAt: null, thumbnailUrl: null }],
      remoteFiles: [{ name: "One.mp4", size: 20 }],
      localFiles: [{ name: "post-0001.mp4", path: localPath, size: 20 }],
      ledger: emptyLedger("plan-1", "pikpak:Archive"),
    });
    const ledger = emptyLedger(plan.planId, plan.target);
    ledger.items["post-0001"] = {
      postId: "post-0001",
      finalName: "One.mp4",
      status: "verified",
      size: 20,
      localPath,
      updatedAt: new Date().toISOString(),
    };
    ledger.runs.push({
      planDigest: plan.digest,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      completedItems: 1,
      status: "completed",
    });
    await state.saveLedger(ledger);
    const cleanup = buildCleanupPlan(plan, ledger);
    await writeFile(localPath, Buffer.alloc(21));
    await expect(
      cleanupVerified({
        plan: cleanup,
        confirmation: cleanup.digest,
        workDir: paths.workDir,
        state,
      }),
    ).rejects.toMatchObject({ code: "PLAN_STALE" });
    expect((await readFile(localPath)).byteLength).toBe(21);
  });

  it("stops before writing when the remote snapshot changed", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-stale-"));
    temporaryDirectories.push(root);
    const paths = appPaths({ stateDir: join(root, "state"), workDir: join(root, "work") });
    const storage = new FakeStorage([]);
    const plan = buildPlan({
      planId: "plan-1",
      target: "pikpak:Archive",
      posts: [{ id: "post-0001", body: "One", publishedAt: null, thumbnailUrl: null }],
      remoteFiles: [],
      localFiles: [],
      ledger: emptyLedger("plan-1", "pikpak:Archive"),
    });
    storage.files.set("external.mp4", 1);
    await expect(
      executeSync({
        plan,
        confirmation: plan.digest,
        jobs: 1,
        workDir: paths.workDir,
        source,
        storage,
        media,
        state: new StateStore(paths),
      }),
    ).rejects.toMatchObject({ code: "PLAN_STALE" });
    expect(storage.operations).toEqual([]);
  });

  it("stops before the next write when an external remote change appears mid-run", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-race-"));
    temporaryDirectories.push(root);
    const paths = appPaths({ stateDir: join(root, "state"), workDir: join(root, "work") });
    const localPath = join(paths.workDir, "plan-1", "post-0002.mp4");
    await mkdir(join(paths.workDir, "plan-1"), { recursive: true });
    await writeFile(localPath, Buffer.alloc(20));
    class RacingStorage extends FakeStorage {
      listCount = 0;
      override async listFiles(): Promise<RemoteFile[]> {
        this.listCount += 1;
        if (this.listCount === 3) this.files.set("external.mp4", 1);
        return super.listFiles();
      }
    }
    const storage = new RacingStorage([{ name: "post-0001.mp4", size: 10 }]);
    const plan = buildPlan({
      planId: "plan-1",
      target: "pikpak:Archive",
      posts: [
        { id: "post-0001", body: "One", publishedAt: null, thumbnailUrl: null },
        { id: "post-0002", body: "Two", publishedAt: null, thumbnailUrl: null },
      ],
      remoteFiles: await storage.listFiles(),
      localFiles: [{ name: "post-0002.mp4", path: localPath, size: 20 }],
      ledger: emptyLedger("plan-1", "pikpak:Archive"),
    });
    storage.listCount = 0;
    await expect(
      executeSync({
        plan,
        confirmation: plan.digest,
        jobs: 1,
        workDir: paths.workDir,
        source,
        storage,
        media,
        state: new StateStore(paths),
      }),
    ).rejects.toMatchObject({ code: "PLAN_STALE" });
    expect(storage.operations).toEqual(["move:post-0001.mp4:One.mp4"]);
    expect(storage.files.has("Two.mp4")).toBe(false);
  });

  it("refuses to roll back a final name without a recorded rename", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-rollback-record-"));
    temporaryDirectories.push(root);
    const paths = appPaths({ stateDir: join(root, "state"), workDir: join(root, "work") });
    const plan = buildPlan({
      planId: "plan-1",
      target: "pikpak:Archive",
      posts: [{ id: "post-0001", body: "One", publishedAt: null, thumbnailUrl: null }],
      remoteFiles: [{ name: "post-0001.mp4", size: 10 }],
      localFiles: [],
      ledger: emptyLedger("plan-1", "pikpak:Archive"),
    });
    const storage = new FakeStorage([{ name: "One.mp4", size: 10 }]);
    await expect(
      rollbackRenames({
        plan,
        confirmation: plan.digest,
        storage,
        state: new StateStore(paths),
      }),
    ).rejects.toMatchObject({ code: "PLAN_INVALID" });
    expect(storage.operations).toEqual([]);
  });
});
