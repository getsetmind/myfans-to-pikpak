import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, extname, join } from "node:path";
import { spawn } from "node:child_process";
import { AppError } from "../core/errors.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function findExecutable(name: string): Promise<string | null> {
  const directories = (process.env.PATH ?? "")
    .split(delimiter)
    .map((value) => value.replace(/^"|"$/g, ""))
    .filter(Boolean);
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  const candidates = extname(name)
    ? [name]
    : extensions.map((extension) => `${name}${extension.toLowerCase()}`);
  for (const directory of directories) {
    for (const candidate of candidates) {
      const path = join(directory, candidate);
      try {
        await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return path;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return null;
}

export function runProcess(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    errorCode?: "DEPENDENCY_MISSING" | "DOWNLOAD_FAILED" | "REMOTE_ERROR";
  } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) =>
      reject(
        new AppError(options.errorCode ?? "DEPENDENCY_MISSING", `Could not start ${executable}.`, {
          cause: error.message,
        }),
      ),
    );
    child.once("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}
