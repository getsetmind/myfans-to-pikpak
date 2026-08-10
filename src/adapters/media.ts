import { createWriteStream } from "node:fs";
import { link, mkdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { AppError } from "../core/errors.js";
import type { VideoSource } from "../core/types.js";
import type { MediaPort, MediaProbe } from "../ports.js";
import { findExecutable, runProcess } from "./process.js";

const USER_AGENT = "Mozilla/5.0 (compatible; myfans-to-pikpak/1.0)";

interface ExecutableCommand {
  path: string;
  prefix: string[];
}

export class MediaTools implements MediaPort {
  private constructor(
    private readonly ffmpeg: ExecutableCommand,
    private readonly ffprobe: ExecutableCommand,
  ) {}

  static async create(): Promise<MediaTools> {
    const [ffmpeg, ffprobe] = await Promise.all([
      findExecutable("ffmpeg"),
      findExecutable("ffprobe"),
    ]);
    if (!ffmpeg || !ffprobe) {
      throw new AppError(
        "DEPENDENCY_MISSING",
        "ffmpeg and ffprobe must both be available on PATH.",
      );
    }
    return new MediaTools({ path: ffmpeg, prefix: [] }, { path: ffprobe, prefix: [] });
  }

  static fromExecutables(input: {
    ffmpeg: string;
    ffprobe: string;
    ffmpegPrefix?: string[];
    ffprobePrefix?: string[];
  }): MediaTools {
    return new MediaTools(
      { path: input.ffmpeg, prefix: input.ffmpegPrefix ?? [] },
      { path: input.ffprobe, prefix: input.ffprobePrefix ?? [] },
    );
  }

  async download(source: VideoSource, destination: string): Promise<MediaProbe> {
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.part`;
    await rm(temporary, { force: true });
    try {
      if (source.kind === "hls") {
        await this.downloadHls(source.url, temporary);
      } else {
        await this.downloadMp4(source.url, temporary);
      }
      const probe = await this.probe(temporary);
      await link(temporary, destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") {
          throw new AppError(
            "PLAN_STALE",
            `Local destination appeared after planning: ${destination}`,
          );
        }
        throw error;
      });
      await rm(temporary, { force: true });
      return probe;
    } catch (error) {
      await rm(temporary, { force: true });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("DOWNLOAD_FAILED", `Download failed for ${destination}.`, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async probe(path: string): Promise<MediaProbe> {
    const file = await stat(path).catch(() => null);
    if (!file?.isFile() || file.size <= 0) {
      throw new AppError("VERIFY_FAILED", `Media file is empty or missing: ${path}`);
    }
    const result = await runProcess(
      this.ffprobe.path,
      [
        ...this.ffprobe.prefix,
        "-v",
        "error",
        "-show_entries",
        "format=size,duration",
        "-of",
        "json",
        path,
      ],
      { errorCode: "DOWNLOAD_FAILED" },
    );
    if (result.exitCode !== 0) {
      throw new AppError("VERIFY_FAILED", `ffprobe rejected the media file: ${path}`);
    }
    let durationSeconds = 0;
    try {
      const payload = JSON.parse(result.stdout) as { format?: { duration?: string } };
      durationSeconds = Number.parseFloat(payload.format?.duration ?? "0");
    } catch {
      throw new AppError("VERIFY_FAILED", `ffprobe returned invalid JSON for: ${path}`);
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new AppError("VERIFY_FAILED", `Media duration is invalid: ${path}`);
    }
    return { size: file.size, durationSeconds };
  }

  private async downloadHls(url: string, temporary: string): Promise<void> {
    const headers = "Referer: https://myfans.jp/\r\nOrigin: https://myfans.jp\r\n";
    const result = await runProcess(
      this.ffmpeg.path,
      [
        ...this.ffmpeg.prefix,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-rw_timeout",
        "30000000",
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "5",
        "-user_agent",
        USER_AGENT,
        "-headers",
        headers,
        "-i",
        url,
        "-c",
        "copy",
        "-bsf:a",
        "aac_adtstoasc",
        "-f",
        "mp4",
        temporary,
      ],
      { errorCode: "DOWNLOAD_FAILED" },
    );
    if (result.exitCode !== 0) {
      throw new AppError("DOWNLOAD_FAILED", result.stderr.trim() || "ffmpeg failed.");
    }
  }

  private async downloadMp4(url: string, temporary: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const headerTimeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch(url, {
          headers: { Referer: "https://myfans.jp/", "User-Agent": USER_AGENT },
          signal: controller.signal,
        });
        clearTimeout(headerTimeout);
        if (!response.ok || !response.body) {
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            await response.body?.cancel().catch(() => undefined);
            await wait(500 * 2 ** attempt);
            continue;
          }
          throw new AppError("DOWNLOAD_FAILED", `Video server returned HTTP ${response.status}.`);
        }
        await pipeline(
          Readable.fromWeb(response.body as unknown as NodeReadableStream),
          createWriteStream(temporary, { flags: "wx" }),
        );
        return;
      } catch (error) {
        clearTimeout(headerTimeout);
        await rm(temporary, { force: true });
        if (error instanceof AppError || attempt === 2) {
          throw error;
        }
        await wait(500 * 2 ** attempt);
      }
    }
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
