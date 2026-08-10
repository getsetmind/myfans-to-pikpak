import { resolve } from "node:path";
import { resolveMyFansToken } from "../adapters/auth.js";
import { MediaTools } from "../adapters/media.js";
import { MyFansClient } from "../adapters/myfans.js";
import { RcloneStorage } from "../adapters/rclone.js";
import {
  resolvePaths,
  unavailableMedia,
  unavailableSource,
  type GlobalOptions,
} from "../cli/options.js";
import type { MediaPort, SourcePort } from "../ports.js";
import { executeSync } from "../services/synchronizer.js";
import { StateStore } from "../state/json-store.js";

interface SyncOptions {
  plan: string;
  confirm: string;
  jobs: number;
}

export async function sync(options: SyncOptions, global: GlobalOptions) {
  const paths = resolvePaths(global);
  const state = new StateStore(paths);
  const syncPlan = await state.loadPlan(resolve(options.plan));
  const storage = await RcloneStorage.create();
  await storage.ensureTarget(syncPlan.target);
  const needsDownload = syncPlan.items.some((item) => item.downloadRequired);
  const needsMedia = syncPlan.items.some((item) => item.action === "transfer");
  let source: SourcePort = unavailableSource();
  if (needsDownload) {
    const auth = await resolveMyFansToken(global.cdpUrl);
    source = new MyFansClient(auth.token);
  }
  const media: MediaPort = needsMedia ? await MediaTools.create() : unavailableMedia();
  return executeSync({
    plan: syncPlan,
    confirmation: options.confirm,
    jobs: options.jobs,
    workDir: paths.workDir,
    source,
    storage,
    media,
    state,
  });
}
