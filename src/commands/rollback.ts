import { resolve } from "node:path";
import { RcloneStorage } from "../adapters/rclone.js";
import { resolvePaths, type GlobalOptions } from "../cli/options.js";
import { rollbackRenames } from "../services/synchronizer.js";
import { StateStore } from "../state/json-store.js";

interface RollbackOptions {
  plan: string;
  confirm: string;
}

export async function rollback(options: RollbackOptions, global: GlobalOptions) {
  const state = new StateStore(resolvePaths(global));
  const syncPlan = await state.loadPlan(resolve(options.plan));
  const storage = await RcloneStorage.create();
  await storage.ensureTarget(syncPlan.target);
  return rollbackRenames({
    plan: syncPlan,
    confirmation: options.confirm,
    storage,
    state,
  });
}
