export const PLAN_SCHEMA_VERSION = 1 as const;
export const LEDGER_SCHEMA_VERSION = 1 as const;
export const CLEANUP_SCHEMA_VERSION = 1 as const;

export interface MyFansPost {
  id: string;
  body: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
}

export interface MyFansPlan {
  id: string;
  name: string;
  postsCount: number | null;
  creatorUsername: string;
  creatorName: string;
  url: string;
  subscriptionId: string;
  subscribedAt: string | null;
  activeUntil: string | null;
  willCancel: boolean;
}

export interface RemoteFile {
  name: string;
  size: number;
}

export interface LocalFile {
  name: string;
  path: string;
  size: number;
}

export type PlanActionKind = "skip" | "rename" | "transfer";

export interface PlanItem {
  postId: string;
  originalName: string;
  finalName: string;
  publishedAt: string | null;
  action: PlanActionKind;
  currentRemoteName: string | null;
  remoteSize: number | null;
  localPath: string | null;
  localSize: number | null;
  downloadRequired: boolean;
}

export interface PlanStats {
  posts: number;
  skip: number;
  rename: number;
  transfer: number;
  download: number;
  collisions: number;
  remoteExtras: number;
  knownTransferBytes: number;
}

export interface SyncPlanContent {
  schemaVersion: typeof PLAN_SCHEMA_VERSION;
  planId: string;
  target: string;
  createdAt: string;
  expiresAt: string;
  remoteSnapshotDigest: string;
  stats: PlanStats;
  items: PlanItem[];
  warnings: string[];
}

export interface SyncPlan extends SyncPlanContent {
  digest: string;
}

export interface CleanupPlanContent {
  schemaVersion: typeof CLEANUP_SCHEMA_VERSION;
  kind: "cleanup";
  planId: string;
  target: string;
  sourcePlanDigest: string;
  createdAt: string;
  items: Array<{ postId: string; path: string; size: number }>;
}

export interface CleanupPlan extends CleanupPlanContent {
  digest: string;
}

export type LedgerStatus = "downloaded" | "uploaded" | "verified";

export interface LedgerItem {
  postId: string;
  finalName: string;
  status: LedgerStatus;
  size: number;
  localPath: string | null;
  updatedAt: string;
}

export interface Ledger {
  schemaVersion: typeof LEDGER_SCHEMA_VERSION;
  planId: string;
  target: string;
  updatedAt: string;
  items: Record<string, LedgerItem>;
  runs: RunRecord[];
}

export interface RunRecord {
  planDigest: string;
  startedAt: string;
  completedAt: string | null;
  completedItems: number;
  status: "running" | "completed" | "failed";
  errorCode?: string;
}

export interface PlanBuildInput {
  planId: string;
  target: string;
  posts: MyFansPost[];
  remoteFiles: RemoteFile[];
  localFiles: LocalFile[];
  ledger: Ledger;
  now?: Date;
  validityMs?: number;
}

export interface VideoSource {
  url: string;
  kind: "hls" | "mp4";
}

export interface JsonEnvelope<T> {
  schemaVersion: 1;
  command: string;
  ok: boolean;
  result: T | null;
  warnings: string[];
  error: { code: string; message: string; details?: unknown } | null;
}
