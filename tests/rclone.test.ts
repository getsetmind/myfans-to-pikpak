import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RcloneStorage, assertRemoteTarget } from "../src/adapters/rclone.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("rclone target validation", () => {
  it("accepts a configured-style target and rejects control characters or malformed remotes", () => {
    expect(() => assertRemoteTarget("pikpak:MyFans/example")).not.toThrow();
    expect(() => assertRemoteTarget("pikpak")).toThrowError(/rclone target/i);
    expect(() => assertRemoteTarget("bad/name:path")).toThrowError(/rclone target/i);
    expect(() => assertRemoteTarget("pikpak:path\nnext")).toThrowError(/rclone target/i);
  });

  it("executes list, immutable move, and upload against a local fake process", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-rclone-"));
    temporaryDirectories.push(root);
    const statePath = join(root, "remote.json");
    const uploadPath = join(root, "upload.mp4");
    await writeFile(statePath, JSON.stringify({ files: { "old.mp4": 10 } }));
    await writeFile(uploadPath, Buffer.alloc(20));
    const storage = RcloneStorage.fromExecutable(process.execPath, [
      resolve("tests/fixtures/fake-rclone.mjs"),
      statePath,
    ]);
    await storage.ensureTarget("pikpak:Archive");
    expect(await storage.listFiles("pikpak:Archive")).toEqual([{ name: "old.mp4", size: 10 }]);
    await storage.move("pikpak:Archive", "old.mp4", "renamed.mp4");
    await storage.upload("pikpak:Archive", uploadPath, "upload.mp4");
    expect(
      (await storage.listFiles("pikpak:Archive")).sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: "renamed.mp4", size: 10 },
      { name: "upload.mp4", size: 20 },
    ]);
    await expect(storage.upload("pikpak:Archive", uploadPath, "upload.mp4")).rejects.toMatchObject({
      code: "REMOTE_ERROR",
    });
  });

  it("treats only rclone's directory-not-found exit code as an empty new target", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-rclone-missing-"));
    temporaryDirectories.push(root);
    const statePath = join(root, "remote.json");
    await writeFile(
      statePath,
      JSON.stringify({
        files: {},
        missingTargets: ["pikpak:New"],
        listFailureTargets: ["pikpak:Denied"],
      }),
    );
    const storage = RcloneStorage.fromExecutable(process.execPath, [
      resolve("tests/fixtures/fake-rclone.mjs"),
      statePath,
    ]);

    await expect(storage.listFiles("pikpak:New")).resolves.toEqual([]);
    await expect(storage.listFiles("pikpak:Denied")).rejects.toMatchObject({
      code: "REMOTE_ERROR",
    });
  });
});
