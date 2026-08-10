import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyLedger } from "../src/core/ledger.js";
import { buildPlan } from "../src/core/plan.js";
import { StateStore } from "../src/state/json-store.js";
import { appPaths, defaultStateDir, stateKey } from "../src/state/paths.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("state storage", () => {
  it("selects platform-appropriate locations and stable private keys", () => {
    const noExistingPath = () => false;
    expect(defaultStateDir("win32", { LOCALAPPDATA: "C:/Data" }, noExistingPath)).toBe(
      join("C:/Data", "myfans-to-pikpak"),
    );
    expect(defaultStateDir("linux", { XDG_STATE_HOME: "/state" }, noExistingPath)).toBe(
      join("/state", "myfans-to-pikpak"),
    );
    expect(stateKey("a", "b")).toHaveLength(32);
    expect(stateKey("a", "b")).toBe(stateKey("a", "b"));
  });

  it("reuses a legacy state directory without moving user data", () => {
    const legacy = join("C:/Data", "myfans-pikpak");
    const current = join("C:/Data", "myfans-to-pikpak");

    expect(defaultStateDir("win32", { LOCALAPPDATA: "C:/Data" }, (path) => path === legacy)).toBe(
      legacy,
    );
    expect(
      defaultStateDir("win32", { LOCALAPPDATA: "C:/Data" }, (path) =>
        [legacy, current].includes(path),
      ),
    ).toBe(current);
  });

  it("round-trips a ledger using atomic JSON writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-state-"));
    temporaryDirectories.push(root);
    const store = new StateStore(appPaths({ stateDir: root }));
    const ledger = emptyLedger("plan-1", "pikpak:Archive", new Date("2026-01-01T00:00:00Z"));
    ledger.items.one = {
      postId: "one",
      finalName: "One.mp4",
      status: "verified",
      size: 10,
      localPath: null,
      updatedAt: "2026-01-01T00:00:00Z",
    };
    await store.saveLedger(ledger);
    expect((await store.loadLedger("plan-1", "pikpak:Archive")).items.one?.size).toBe(10);
    expect(
      JSON.parse(await readFile(store.ledgerPath("plan-1", "pikpak:Archive"), "utf8")),
    ).toMatchObject({ planId: "plan-1" });
  });

  it("creates plan files privately and refuses to overwrite them", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-plan-file-"));
    temporaryDirectories.push(root);
    const store = new StateStore(appPaths({ stateDir: root }));
    const plan = buildPlan({
      planId: "plan-1",
      target: "pikpak:Archive",
      posts: [],
      remoteFiles: [],
      localFiles: [],
      ledger: emptyLedger("plan-1", "pikpak:Archive"),
    });
    const path = join(root, "sync-plan.json");
    await store.savePlan(path, plan);
    await expect(store.savePlan(path, plan)).rejects.toMatchObject({ code: "STATE_ERROR" });
    expect((await store.loadPlan(path)).digest).toBe(plan.digest);
  });
});
