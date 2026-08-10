import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppPaths {
  stateDir: string;
  workDir: string;
  plansDir: string;
  ledgersDir: string;
}

export function defaultStateDir(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
): string {
  let parent: string;
  if (platform === "win32") {
    parent = environment.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  } else if (platform === "darwin") {
    parent = join(homedir(), "Library", "Application Support");
  } else {
    parent = environment.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  }

  const current = join(parent, "myfans-to-pikpak");
  const legacy = join(parent, "myfans-pikpak");
  if (!pathExists(current) && pathExists(legacy)) {
    return legacy;
  }
  return current;
}

export function appPaths(overrides: { stateDir?: string; workDir?: string } = {}): AppPaths {
  const stateDir = overrides.stateDir ?? defaultStateDir();
  return {
    stateDir,
    workDir: overrides.workDir ?? join(stateDir, "downloads"),
    plansDir: join(stateDir, "plans"),
    ledgersDir: join(stateDir, "ledgers"),
  };
}

export function stateKey(planId: string, target: string): string {
  return createHash("sha256").update(`${planId}\0${target}`).digest("hex").slice(0, 32);
}
