import fsp from "node:fs/promises";
import path from "node:path";
import type { AssetStore } from "./stores.js";

/** AssetStore backed by a local folder (one sub-folder per bucket). Used in tests and local dev. */
export class LocalAssetStore implements AssetStore {
  constructor(private readonly root: string) {}

  private file(bucket: string, objectPath: string): string {
    return path.join(this.root, bucket, ...objectPath.split("/"));
  }

  async list(bucket: string, prefix: string): Promise<string[]> {
    try {
      const entries = await fsp.readdir(this.file(bucket, prefix), { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async download(bucket: string, objectPath: string, localFile: string): Promise<boolean> {
    try {
      await fsp.mkdir(path.dirname(localFile), { recursive: true });
      await fsp.copyFile(this.file(bucket, objectPath), localFile);
      return true;
    } catch {
      return false;
    }
  }

  async upload(bucket: string, objectPath: string, localFile: string): Promise<void> {
    const dest = this.file(bucket, objectPath);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(localFile, dest);
  }

  async remove(bucket: string, objectPaths: string[]): Promise<void> {
    await Promise.all(objectPaths.map((p) => fsp.rm(this.file(bucket, p), { force: true })));
  }
}
