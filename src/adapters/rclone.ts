import { AppError } from "../core/errors.js";
import { isSafeRemoteTarget } from "../core/safety.js";
import type { RemoteFile } from "../core/types.js";
import type { StoragePort } from "../ports.js";
import { findExecutable, runProcess } from "./process.js";

export function assertRemoteTarget(target: string): void {
  if (!isSafeRemoteTarget(target)) {
    throw new AppError(
      "USAGE_ERROR",
      "--to must be an rclone target such as pikpak:MyFans/archive.",
    );
  }
}

export class RcloneStorage implements StoragePort {
  private constructor(
    private readonly executable: string,
    private readonly argumentPrefix: string[] = [],
  ) {}

  static async create(): Promise<RcloneStorage> {
    const executable = await findExecutable("rclone");
    if (!executable) {
      throw new AppError("DEPENDENCY_MISSING", "rclone was not found on PATH.");
    }
    return new RcloneStorage(executable);
  }

  static fromExecutable(executable: string, argumentPrefix: string[] = []): RcloneStorage {
    return new RcloneStorage(executable, argumentPrefix);
  }

  async configuredRemotes(): Promise<string[]> {
    const result = await this.run(["listremotes"]);
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async ensureTarget(target: string): Promise<void> {
    assertRemoteTarget(target);
    const remote = `${target.slice(0, target.indexOf(":"))}:`;
    if (!(await this.configuredRemotes()).includes(remote)) {
      throw new AppError("REMOTE_ERROR", `rclone remote is not configured: ${remote}`);
    }
  }

  async listFiles(target: string): Promise<RemoteFile[]> {
    assertRemoteTarget(target);
    const result = await this.run(
      ["lsjson", target, "--files-only", "--no-mimetype", "--no-modtime"],
      { allowDirectoryNotFound: true },
    );
    if (result.exitCode === 3) {
      return [];
    }
    let values: unknown;
    try {
      values = JSON.parse(result.stdout);
    } catch {
      throw new AppError("REMOTE_ERROR", "rclone returned invalid JSON.");
    }
    if (!Array.isArray(values)) {
      throw new AppError("REMOTE_ERROR", "rclone returned an unexpected file listing.");
    }
    return values.map((value) => {
      const item = value as { Name?: unknown; Path?: unknown; Size?: unknown };
      const name = typeof item.Name === "string" ? item.Name : item.Path;
      if (typeof name !== "string" || typeof item.Size !== "number") {
        throw new AppError("REMOTE_ERROR", "rclone returned an invalid file entry.");
      }
      return { name, size: item.Size };
    });
  }

  async move(target: string, fromName: string, toName: string): Promise<void> {
    await this.run([
      "moveto",
      remotePath(target, fromName),
      remotePath(target, toName),
      "--no-traverse",
      "--immutable",
    ]);
  }

  async upload(target: string, localPath: string, remoteName: string): Promise<void> {
    await this.run([
      "copyto",
      localPath,
      remotePath(target, remoteName),
      "--no-traverse",
      "--immutable",
    ]);
  }

  private async run(args: string[], options: { allowDirectoryNotFound?: boolean } = {}) {
    const result = await runProcess(
      this.executable,
      [
        ...this.argumentPrefix,
        ...args,
        "--retries",
        "3",
        "--low-level-retries",
        "10",
        "--retries-sleep",
        "2s",
      ],
      { errorCode: "REMOTE_ERROR" },
    );
    if (result.exitCode !== 0 && !(options.allowDirectoryNotFound && result.exitCode === 3)) {
      throw new AppError("REMOTE_ERROR", result.stderr.trim() || "rclone failed.", {
        exitCode: result.exitCode,
      });
    }
    return result;
  }
}

function remotePath(target: string, name: string): string {
  const base = target.replace(/\/+$/, "");
  return `${base}${base.endsWith(":") ? "" : "/"}${name}`;
}
