import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LocalFile } from "../core/types.js";

export async function listLocalVideos(directory: string): Promise<LocalFile[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const files: LocalFile[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".mp4") || name.toLowerCase().endsWith(".mp4.part")) {
      continue;
    }
    const path = join(directory, name);
    const metadata = await stat(path);
    if (metadata.isFile() && metadata.size > 0) {
      files.push({ name, path, size: metadata.size });
    }
  }
  return files;
}
