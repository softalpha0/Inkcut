import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Walks up from this file to the folder holding pnpm-workspace.yaml. */
export function findRepoRoot(start: string = here): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/** Loads <repo>/.env without overriding variables already set in the shell. */
export function loadEnv(): void {
  const envPath = path.join(findRepoRoot(), ".env");
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, quiet: true });
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Add it to .env (see .env.example).`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function defaultOutDir(): string {
  const configured = process.env.INKCUT_OUT_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(findRepoRoot(), "out");
}

/** Bundled assets (fonts) shipped with the pipeline package. */
export const ASSETS_DIR = path.resolve(here, "..", "assets");
