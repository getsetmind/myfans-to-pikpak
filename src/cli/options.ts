import { homedir } from "node:os";
import { parse as parsePath, resolve } from "node:path";
import { AppError } from "../core/errors.js";
import { isSafeIdentifier } from "../core/safety.js";
import type { MediaPort, SourcePort } from "../ports.js";
import { appPaths } from "../state/paths.js";

export interface GlobalOptions {
  json?: boolean;
  stateDir?: string;
  workDir?: string;
  cdpUrl: string;
}

export function resolvePaths(options: GlobalOptions): ReturnType<typeof appPaths> {
  const paths = appPaths({
    ...(options.stateDir ? { stateDir: resolve(options.stateDir) } : {}),
    ...(options.workDir ? { workDir: resolve(options.workDir) } : {}),
  });
  assertNonRootPath(paths.stateDir, "--state-dir");
  assertNonRootPath(paths.workDir, "--work-dir");
  return paths;
}

export function parsePlanId(value: string): string {
  let candidate = value.trim();
  try {
    const url = new URL(candidate);
    if (url.hostname !== "myfans.jp" && !url.hostname.endsWith(".myfans.jp")) {
      throw new AppError("USAGE_ERROR", "--plan-id URL must use the myfans.jp domain.");
    }
    const match = url.pathname.match(/\/plans\/([a-zA-Z0-9_-]+)/);
    if (match?.[1]) {
      candidate = match[1];
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    // A value that is not a URL may still be a valid bare plan ID.
  }
  if (!isSafeIdentifier(candidate)) {
    throw new AppError("USAGE_ERROR", "--plan-id must be a plan ID or a MyFans plan URL.");
  }
  return candidate;
}

export function parseJobs(value: string): number {
  const jobs = Number(value);
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) {
    throw new AppError("USAGE_ERROR", "--jobs must be an integer from 1 to 16.");
  }
  return jobs;
}

export function nodeVersionIsSupported(version = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}

export function knownSensitiveValues(): string[] {
  return [process.env.MYFANS_TOKEN, homedir()].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

export function unavailableSource(): SourcePort {
  const unavailable = async (): Promise<never> => {
    throw new AppError("INTERNAL_ERROR", "Source adapter was not initialized.");
  };
  return { listPlans: unavailable, listPosts: unavailable, getVideoSource: unavailable };
}

export function unavailableMedia(): MediaPort {
  const unavailable = async (): Promise<never> => {
    throw new AppError("INTERNAL_ERROR", "Media adapter was not initialized.");
  };
  return { download: unavailable, probe: unavailable };
}

function assertNonRootPath(path: string, option: string): void {
  if (parsePath(path).root === path) {
    throw new AppError("USAGE_ERROR", `${option} cannot be a filesystem root.`);
  }
}
