import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { HttpError } from "./retry.js";

export async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(p);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/** Write via a temp file + rename so a crash never leaves a half-written file behind. */
export async function writeFileAtomic(p: string, data: string | Uint8Array): Promise<void> {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, p);
}

export async function writeJson(p: string, value: unknown): Promise<void> {
  await writeFileAtomic(p, JSON.stringify(value, null, 2) + "\n");
}

export async function readJson(p: string): Promise<unknown> {
  return JSON.parse(await fsp.readFile(p, "utf8")) as unknown;
}

/** Streams a URL to disk (temp file + rename). */
export async function downloadToFile(url: string, dest: string, signal: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) {
    throw new HttpError(res.status, `Download failed (${res.status}) for ${url}`);
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  await pipeline(Readable.fromWeb(res.body as NodeReadableStream), fs.createWriteStream(tmp));
  await fsp.rename(tmp, dest);
}

/** Paths stored in the manifest are relative to the project dir, with forward slashes. */
export function toManifestPath(projectDir: string, absolute: string): string {
  return path.relative(projectDir, absolute).split(path.sep).join("/");
}

export function fromManifestPath(projectDir: string, rel: string): string {
  return path.join(projectDir, ...rel.split("/"));
}

/**
 * Copies the .ttf files of `fontsDir` into `dest` (for libass), skipping files that
 * are already there with the same size. Re-copying a font FFmpeg may still have
 * open fails on Windows (EBUSY).
 */
export async function ensureFonts(fontsDir: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  for (const f of await fsp.readdir(fontsDir)) {
    if (!f.toLowerCase().endsWith(".ttf")) continue;
    const from = path.join(fontsDir, f);
    const to = path.join(dest, f);
    const [a, b] = await Promise.all([fsp.stat(from), fsp.stat(to).catch(() => undefined)]);
    if (b && b.size === a.size) continue;
    await fsp.copyFile(from, to);
  }
}
