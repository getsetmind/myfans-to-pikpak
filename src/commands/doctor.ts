import { resolveMyFansToken } from "../adapters/auth.js";
import { findExecutable } from "../adapters/process.js";
import { RcloneStorage } from "../adapters/rclone.js";
import { AppError, asAppError } from "../core/errors.js";
import { nodeVersionIsSupported, type GlobalOptions } from "../cli/options.js";

interface DoctorOptions {
  to?: string;
}

export async function doctor(options: DoctorOptions, global: GlobalOptions) {
  const [ffmpeg, ffprobe, rclone] = await Promise.all([
    findExecutable("ffmpeg"),
    findExecutable("ffprobe"),
    findExecutable("rclone"),
  ]);

  let auth: { ok: boolean; source: string | null; message: string | null };
  try {
    const result = await resolveMyFansToken(global.cdpUrl);
    auth = { ok: true, source: result.source, message: null };
  } catch (error) {
    auth = { ok: false, source: null, message: asAppError(error).message };
  }

  let remote: { ok: boolean; target: string | null; message: string | null } = {
    ok: options.to === undefined,
    target: options.to ?? null,
    message: options.to === undefined ? "not requested" : null,
  };
  if (options.to && rclone) {
    try {
      const storage = await RcloneStorage.create();
      await storage.ensureTarget(options.to);
      remote = { ok: true, target: options.to, message: null };
    } catch (error) {
      remote = { ok: false, target: options.to, message: asAppError(error).message };
    }
  } else if (options.to && !rclone) {
    remote = { ok: false, target: options.to, message: "rclone was not found on PATH." };
  }

  const dependencies = {
    node: { ok: nodeVersionIsSupported(), version: process.versions.node },
    ffmpeg: { ok: ffmpeg !== null, command: "ffmpeg" },
    ffprobe: { ok: ffprobe !== null, command: "ffprobe" },
    rclone: { ok: rclone !== null, command: "rclone" },
  };
  const result = {
    healthy: Object.values(dependencies).every((check) => check.ok) && auth.ok && remote.ok,
    dependencies,
    authentication: auth,
    remote,
  };

  if (!Object.values(dependencies).every((check) => check.ok)) {
    throw new AppError(
      "DEPENDENCY_MISSING",
      "One or more required runtimes are unavailable.",
      result,
    );
  }
  if (!auth.ok) {
    throw new AppError(
      "AUTH_REQUIRED",
      auth.message ?? "MyFans authentication is unavailable.",
      result,
    );
  }
  if (!remote.ok) {
    throw new AppError(
      "REMOTE_ERROR",
      remote.message ?? "The rclone target is unavailable.",
      result,
    );
  }
  return result;
}
