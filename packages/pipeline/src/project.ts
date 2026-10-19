import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  ProjectManifestSchema,
  type Aspect,
  type ProjectInput,
  type ProjectManifest,
  type StageName,
} from "@inkcut/shared";
import { fileExists, fromManifestPath, readJson, toManifestPath, writeJson } from "./util/fs.js";

export const MANIFEST_FILE = "project.json";

export function slugify(text: string, maxLen = 40): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug || "video";
}

export function newProjectId(label: string): string {
  return `${slugify(label)}-${crypto.randomBytes(3).toString("hex")}`;
}

export interface NewProjectOptions {
  id?: string;
  input: ProjectInput;
  styleId: string;
  aspect: Aspect;
  voiceId: string;
  captions: boolean;
  seed: number;
  animate?: { enabled: boolean; maxScenes?: number };
}

/** One video project on disk: out/<id>/ with project.json as the resume record. */
export class Project {
  private saving: Promise<void> = Promise.resolve();

  private constructor(
    readonly dir: string,
    public manifest: ProjectManifest,
  ) {}

  get id(): string {
    return this.manifest.id;
  }

  static async create(outDir: string, opts: NewProjectOptions & { id: string }): Promise<Project> {
    const dir = path.join(outDir, opts.id);
    if (await fileExists(path.join(dir, MANIFEST_FILE))) {
      throw new Error(`Project ${opts.id} already exists in ${dir}`);
    }
    await fsp.mkdir(dir, { recursive: true });
    const now = new Date().toISOString();
    const manifest: ProjectManifest = {
      version: 1,
      id: opts.id,
      createdAt: now,
      updatedAt: now,
      input: opts.input,
      styleId: opts.styleId,
      aspect: opts.aspect,
      voiceId: opts.voiceId,
      captions: opts.captions,
      seed: opts.seed,
      ...(opts.animate ? { animate: opts.animate } : {}),
      completedStages: [],
      scenes: [],
      runs: [],
    };
    const project = new Project(dir, manifest);
    await project.save();
    return project;
  }

  static async load(outDir: string, id: string): Promise<Project> {
    const dir = path.join(outDir, id);
    const file = path.join(dir, MANIFEST_FILE);
    if (!(await fileExists(file))) throw new Error(`No project "${id}" found (looked for ${file})`);
    const manifest = ProjectManifestSchema.parse(await readJson(file));
    return new Project(dir, manifest);
  }

  /** Absolute path inside the project. */
  path(...parts: string[]): string {
    return path.join(this.dir, ...parts);
  }

  /** Converts a manifest-relative path ("audio/000.mp3") to absolute. */
  abs(rel: string): string {
    return fromManifestPath(this.dir, rel);
  }

  rel(absolute: string): string {
    return toManifestPath(this.dir, absolute);
  }

  isDone(stage: StageName): boolean {
    return this.manifest.completedStages.includes(stage);
  }

  markDone(stage: StageName): Promise<void> {
    if (!this.isDone(stage)) this.manifest.completedStages.push(stage);
    return this.save();
  }

  /** Serialised so concurrent scene workers never interleave writes. */
  save(): Promise<void> {
    this.saving = this.saving.then(async () => {
      this.manifest.updatedAt = new Date().toISOString();
      await writeJson(this.path(MANIFEST_FILE), ProjectManifestSchema.parse(this.manifest));
    });
    return this.saving;
  }
}

export function sceneFileName(index: number, ext: string): string {
  return `${String(index).padStart(3, "0")}.${ext}`;
}
