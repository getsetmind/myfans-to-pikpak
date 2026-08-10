import { assertRemoteTarget } from "../adapters/rclone.js";
import { parsePlanId, resolvePaths, type GlobalOptions } from "../cli/options.js";
import { StateStore } from "../state/json-store.js";

interface StatusOptions {
  planId: string;
  to: string;
}

export async function status(options: StatusOptions, global: GlobalOptions) {
  const state = new StateStore(resolvePaths(global));
  assertRemoteTarget(options.to);
  const ledger = await state.loadLedger(parsePlanId(options.planId), options.to);
  const counts = { downloaded: 0, uploaded: 0, verified: 0 };
  for (const item of Object.values(ledger.items)) {
    counts[item.status] += 1;
  }
  return {
    planId: ledger.planId,
    target: ledger.target,
    updatedAt: ledger.updatedAt,
    counts,
    items: ledger.items,
    runs: ledger.runs,
  };
}
