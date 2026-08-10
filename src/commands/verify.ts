import { resolve } from "node:path";
import { RcloneStorage } from "../adapters/rclone.js";
import { resolvePaths, type GlobalOptions } from "../cli/options.js";
import { AppError } from "../core/errors.js";
import { verifyExpectedRemote } from "../services/synchronizer.js";
import { StateStore } from "../state/json-store.js";

interface VerifyOptions {
  plan: string;
}

export async function verify(options: VerifyOptions, global: GlobalOptions) {
  const state = new StateStore(resolvePaths(global));
  const syncPlan = await state.loadPlan(resolve(options.plan));
  const storage = await RcloneStorage.create();
  await storage.ensureTarget(syncPlan.target);
  const [files, ledger] = await Promise.all([
    storage.listFiles(syncPlan.target),
    state.loadLedger(syncPlan.planId, syncPlan.target),
  ]);
  const result = verifyExpectedRemote(syncPlan, files, ledger);
  if (!result.ok) {
    throw new AppError(
      "VERIFY_FAILED",
      "One or more planned remote files failed verification.",
      result,
    );
  }
  return result;
}
