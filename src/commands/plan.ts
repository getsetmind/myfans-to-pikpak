import { resolve } from "node:path";
import { resolveMyFansToken } from "../adapters/auth.js";
import { MyFansClient } from "../adapters/myfans.js";
import { RcloneStorage, assertRemoteTarget } from "../adapters/rclone.js";
import { parsePlanId, resolvePaths, type GlobalOptions } from "../cli/options.js";
import { buildPlan } from "../core/plan.js";
import { listLocalVideos } from "../services/local-files.js";
import { StateStore } from "../state/json-store.js";

interface PlanOptions {
  planId: string;
  to: string;
  out: string;
}

export async function plan(options: PlanOptions, global: GlobalOptions) {
  const planId = parsePlanId(options.planId);
  assertRemoteTarget(options.to);
  const paths = resolvePaths(global);
  const state = new StateStore(paths);
  const storage = await RcloneStorage.create();
  await storage.ensureTarget(options.to);
  const auth = await resolveMyFansToken(global.cdpUrl);
  const source = new MyFansClient(auth.token);
  const [posts, remoteFiles, localFiles, ledger] = await Promise.all([
    source.listPosts(planId),
    storage.listFiles(options.to),
    listLocalVideos(resolve(paths.workDir, planId)),
    state.loadLedger(planId, options.to),
  ]);
  const syncPlan = buildPlan({
    planId,
    target: options.to,
    posts,
    remoteFiles,
    localFiles,
    ledger,
  });
  const output = resolve(options.out);
  await state.savePlan(output, syncPlan);
  return {
    path: options.out,
    digest: syncPlan.digest,
    expiresAt: syncPlan.expiresAt,
    stats: syncPlan.stats,
    items: syncPlan.items.map((item) => ({
      postId: item.postId,
      action: item.action,
      currentRemoteName: item.currentRemoteName,
      finalName: item.finalName,
      downloadRequired: item.downloadRequired,
      knownBytes: item.localSize ?? item.remoteSize,
    })),
    warnings: syncPlan.warnings,
  };
}
