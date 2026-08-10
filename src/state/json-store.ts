import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError } from "../core/errors.js";
import { assertValidCleanupPlan } from "../core/cleanup-plan.js";
import { emptyLedger, isLedger } from "../core/ledger.js";
import { assertValidPlan } from "../core/plan.js";
import type { CleanupPlan, Ledger, SyncPlan } from "../core/types.js";
import type { AppPaths } from "./paths.js";
import { stateKey } from "./paths.js";

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new AppError("STATE_ERROR", `Could not read JSON state: ${path}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new AppError("STATE_ERROR", `Could not atomically replace JSON state: ${path}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function writeJsonExclusive(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await link(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AppError("STATE_ERROR", `Refusing to overwrite an existing plan file: ${path}`);
    }
    throw new AppError("STATE_ERROR", `Could not create plan file: ${path}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  await rm(temporary, { force: true });
}

export class StateStore {
  constructor(private readonly paths: AppPaths) {}

  ledgerPath(planId: string, target: string): string {
    return join(this.paths.ledgersDir, `${stateKey(planId, target)}.json`);
  }

  async loadLedger(planId: string, target: string): Promise<Ledger> {
    const value = await readJson(this.ledgerPath(planId, target));
    if (value === null) {
      return emptyLedger(planId, target);
    }
    if (!isLedger(value) || value.planId !== planId || value.target !== target) {
      throw new AppError("STATE_ERROR", "The ledger is invalid or belongs to another target.");
    }
    return value;
  }

  async saveLedger(ledger: Ledger): Promise<void> {
    ledger.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.ledgerPath(ledger.planId, ledger.target), ledger);
  }

  async loadPlan(path: string): Promise<SyncPlan> {
    const value = await readJson(path);
    if (value === null) {
      throw new AppError("PLAN_INVALID", `Plan file not found: ${path}`);
    }
    assertValidPlan(value);
    return value;
  }

  async savePlan(path: string, plan: SyncPlan): Promise<void> {
    await writeJsonExclusive(path, plan);
  }

  async loadCleanupPlan(path: string): Promise<CleanupPlan> {
    const value = await readJson(path);
    if (value === null) {
      throw new AppError("PLAN_INVALID", `Cleanup plan file not found: ${path}`);
    }
    assertValidCleanupPlan(value);
    return value;
  }

  async saveCleanupPlan(path: string, plan: CleanupPlan): Promise<void> {
    await writeJsonExclusive(path, plan);
  }
}
