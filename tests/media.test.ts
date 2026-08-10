import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MediaTools } from "../src/adapters/media.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function fakeMedia(): MediaTools {
  const script = resolve("tests/fixtures/fake-media.mjs");
  return MediaTools.fromExecutables({
    ffmpeg: process.execPath,
    ffprobe: process.execPath,
    ffmpegPrefix: [script, "ffmpeg"],
    ffprobePrefix: [script, "ffprobe"],
  });
}

describe("media adapter", () => {
  it("streams an MP4, retries a server failure, probes it, and refuses overwrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-media-"));
    temporaryDirectories.push(root);
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      if (requests === 1) {
        response.statusCode = 503;
        response.end();
        return;
      }
      response.setHeader("Content-Type", "video/mp4");
      response.end(Buffer.alloc(16));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const destination = join(root, "video.mp4");
    try {
      await expect(
        fakeMedia().download({ kind: "mp4", url: `http://127.0.0.1:${port}/video` }, destination),
      ).resolves.toMatchObject({ size: 16, durationSeconds: 2.5 });
      expect(requests).toBe(2);
      expect((await readFile(destination)).byteLength).toBe(16);

      await expect(
        fakeMedia().download({ kind: "mp4", url: `http://127.0.0.1:${port}/video` }, destination),
      ).rejects.toMatchObject({ code: "PLAN_STALE" });
      expect((await readFile(destination)).byteLength).toBe(16);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("runs HLS through the FFmpeg command and verifies the result", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-hls-"));
    temporaryDirectories.push(root);
    const destination = join(root, "video.mp4");
    await expect(
      fakeMedia().download({ kind: "hls", url: "https://example.invalid/video.m3u8" }, destination),
    ).resolves.toMatchObject({ size: 12, durationSeconds: 2.5 });
  });

  it("rejects empty media during probing", async () => {
    const root = await mkdtemp(join(tmpdir(), "myfans-to-pikpak-empty-media-"));
    temporaryDirectories.push(root);
    const path = join(root, "empty.mp4");
    await writeFile(path, Buffer.alloc(0));
    await expect(fakeMedia().probe(path)).rejects.toMatchObject({ code: "VERIFY_FAILED" });
  });
});
