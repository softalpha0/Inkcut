import fsp from "node:fs/promises";
import path from "node:path";
import { ASSET_FOLDERS, BUCKETS } from "@inkcut/db";
import { contentTypeFor } from "./content-type.js";
import type { AssetStore } from "./stores.js";

/** mtime (ms) of every file right after hydrate, so persist only uploads what changed. */
export type Snapshot = Map<string, number>;

const join = (...parts: string[]) => parts.filter(Boolean).join("/");

/** Downloads a project's saved files (project.json, script, audio, images, clips) into `localDir`. */
export async function hydrate(assets: AssetStore, prefix: string, localDir: string): Promise<Snapshot> {
  const snapshot: Snapshot = new Map();
  for (const folder of ASSET_FOLDERS) {
    const names = await assets.list(BUCKETS.assets, join(prefix, folder));
    for (const name of names) {
      const rel = join(folder, name);
      const local = path.join(localDir, ...rel.split("/"));
      if (await assets.download(BUCKETS.assets, join(prefix, rel), local)) {
        snapshot.set(rel, (await fsp.stat(local)).mtimeMs);
      }
    }
  }
  return snapshot;
}

/** Files worth keeping between jobs: everything in the project folders except temp and render files. */
async function collect(localDir: string): Promise<string[]> {
  const files: string[] = [];
  for (const folder of ASSET_FOLDERS) {
    let entries;
    try {
      entries = await fsp.readdir(path.join(localDir, folder), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || /\.(tmp|src)$|\.tmp\./.test(e.name) || e.name === "final.mp4") continue;
      files.push(join(folder, e.name));
    }
  }
  return files;
}

/** Uploads new or changed files back to the assets bucket. Returns the uploaded relative paths. */
export async function persist(
  assets: AssetStore,
  prefix: string,
  localDir: string,
  snapshot: Snapshot,
): Promise<string[]> {
  const uploaded: string[] = [];
  for (const rel of await collect(localDir)) {
    const local = path.join(localDir, ...rel.split("/"));
    const mtime = (await fsp.stat(local)).mtimeMs;
    if (snapshot.get(rel) === mtime) continue;
    await assets.upload(BUCKETS.assets, join(prefix, rel), local, contentTypeFor(local));
    snapshot.set(rel, mtime);
    uploaded.push(rel);
  }
  return uploaded;
}

/** Removes every saved file of a project from the assets bucket. */
export async function removeAssets(assets: AssetStore, prefix: string): Promise<void> {
  for (const folder of ASSET_FOLDERS) {
    const names = await assets.list(BUCKETS.assets, join(prefix, folder));
    if (names.length)
      await assets.remove(
        BUCKETS.assets,
        names.map((n) => join(prefix, folder, n)),
      );
  }
}
