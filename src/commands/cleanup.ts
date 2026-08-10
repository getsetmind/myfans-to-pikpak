import { resolve } from "node:path";
import { resolvePaths, type GlobalOptions } from "../cli/options.js";
import { buildCleanupPlan } from "../core/cleanup-plan.js";
import { AppError } from "../core/errors.js";
import { cleanupVerified } from "../services/synchronizer.js";
import { StateStore } from "../state/json-store.js";

interface CleanupOptions {
  sourcePlan?: string;
  out?: string;
  plan?: string;
  confirm?: string;
}

export async function cleanup(options: CleanupOptions, global: GlobalOptions) {
  const paths = resolvePaths(global);
  const state = new StateStore(paths);
  if (options.sourcePlan || options.out) {
    if (!options.sourcePlan || !options.out || options.plan || options.confirm) {
      throw new AppError("USAGE_ERROR", "Preparation requires only --source-plan and --out.");
    }
    const syncPlan = await state.loadPlan(resolve(options.sourcePlan));
    const ledger = await state.loadLedger(syncPlan.planId, syncPlan.target);
    const cleanupPlan = buildCleanupPlan(syncPlan, ledger);
    const output = resolve(options.out);
    await state.saveCleanupPlan(output, cleanupPlan);
    return {
      prepared: true,
      path: options.out,
      digest: cleanupPlan.digest,
      files: cleanupPlan.items.length,
      items: cleanupPlan.items,
    };
  }
  if (!options.plan || !options.confirm) {
    throw new AppError("USAGE_ERROR", "Execution requires --plan and --confirm.");
  }
  const cleanupPlan = await state.loadCleanupPlan(resolve(options.plan));
  return cleanupVerified({
    plan: cleanupPlan,
    confirmation: options.confirm,
    workDir: paths.workDir,
    state,
  });
}
