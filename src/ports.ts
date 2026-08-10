import type { MyFansPlan, MyFansPost, RemoteFile, VideoSource } from "./core/types.js";

export interface SourcePort {
  listPlans(): Promise<MyFansPlan[]>;
  listPosts(planId: string): Promise<MyFansPost[]>;
  getVideoSource(postId: string): Promise<VideoSource>;
}

export interface StoragePort {
  listFiles(target: string): Promise<RemoteFile[]>;
  move(target: string, fromName: string, toName: string): Promise<void>;
  upload(target: string, localPath: string, remoteName: string): Promise<void>;
}

export interface MediaProbe {
  size: number;
  durationSeconds: number;
}

export interface MediaPort {
  download(source: VideoSource, destination: string): Promise<MediaProbe>;
  probe(path: string): Promise<MediaProbe>;
}
