import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listLocalVideos } from "../src/services/local-files.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("local media discovery", () => {
  it("returns only non-empty top-level MP4 files and tolerates a missing directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-local-"));
    temporaryDirectories.push(root);
    await expect(listLocalVideos(join(root, "missing"))).resolves.toEqual([]);
    await writeFile(join(root, "video.mp4"), Buffer.alloc(10));
    await writeFile(join(root, "empty.mp4"), Buffer.alloc(0));
    await writeFile(join(root, "notes.txt"), "fixture");
    await expect(listLocalVideos(root)).resolves.toEqual([
      { name: "video.mp4", path: join(root, "video.mp4"), size: 10 },
    ]);
  });
});
