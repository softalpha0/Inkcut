import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BUCKETS, assetsPrefix, outputPath, type ProjectRow, type SceneRow } from "@inkcut/db";
import {
  ApiCallCounter,
  MANIFEST_FILE,
  Project,
  createLogger,
  defaultMedia,
  errorMessage,
  getStyle,
  projectSeed,
  runPipeline,
  sceneFileName,
  thumbnailFiles,
  thumbnailSeed,
  type Logger,
  type MediaTools,
  type Providers,
} from "@inkcut/pipeline";
import {
  LIMITS,
  STAGE_STATUS,
  type JobData,
  type ProjectInput,
  type ProjectStatus,
  type StageName,
} from "@inkcut/shared";
import { hydrate, persist, removeAssets } from "./sync.js";
import type { AssetStore, ProjectStore, SceneInput } from "./stores.js";

export interface WorkerDeps {
  projects: ProjectStore;
  assets: AssetStore;
  /** New providers per job so API call counts are per job. */
  providers: (counter: ApiCallCounter, log: Logger) => Providers;
  media?: MediaTools;
  /** Parent folder for per-job working copies. Default: OS temp dir. */
  workRoot?: string;
  log?: Logger;
  now?: () => Date;
}

type ProjectJob = Exclude<JobData, { type: "cleanup" }>;

const ONLY: Record<ProjectJob["type"], StageName[] | undefined> = {
  generate: undefined,
  redraw: ["draw", "animate"],
  revoice: ["voice"],
  // Also makes thumbnails for videos created before thumbnails existed (no-op when present).
  render: ["render", "thumbnail"],
  thumbnail: ["thumbnail"],
};

/** Status after a job succeeds: jobs that end with a render are done; scene edits need a new render. */
function doneStatus(data: ProjectJob, row: ProjectRow): ProjectStatus {
  switch (data.type) {
    case "generate":
    case "render":
      return "done";
    case "redraw":
    case "revoice":
      return "draft";
    case "thumbnail":
      // A thumbnail edit does not touch the video.
      return row.output_path ? "done" : "draft";
  }
}

function inputFor(row: ProjectRow, audioExt: string): ProjectInput {
  switch (row.input_mode) {
    case "topic":
      return { mode: "topic", topic: row.topic ?? "", minutes: row.minutes ?? 1 };
    case "script":
      return { mode: "script", scriptFile: "script.txt" };
    case "audio":
      return { mode: "audio", audioFile: `input/voiceover${audioExt}` };
  }
}

/** Creates the local pipeline project for a new DB project (first generate job). */
async function createLocalProject(row: ProjectRow, workDir: string, deps: WorkerDeps): Promise<Project> {
  const audioExt = row.audio_path ? path.extname(row.audio_path).toLowerCase() : ".mp3";
  const project = await Project.create(workDir, {
    id: row.id,
    input: inputFor(row, audioExt),
    styleId: row.style_id,
    ...(row.custom_style ? { customStyle: row.custom_style } : {}),
    aspect: row.aspect,
    voiceId: row.voice_id,
    captions: row.captions,
    seed: projectSeed(getStyle(row.style_id, row.custom_style ?? undefined), row.id),
    ...(row.animate ? { animate: { enabled: true } } : {}),
  });
  if (row.input_mode === "script") {
    if (!row.script?.trim()) throw new Error("This project has no script");
    await fsp.writeFile(project.path("script.txt"), row.script.replace(/\s+/g, " ").trim() + "\n");
  }
  if (row.input_mode === "audio") {
    if (!row.audio_path) throw new Error("This project has no uploaded voiceover");
    const local = project.path("input", `voiceover${audioExt}`);
    if (!(await deps.assets.download(BUCKETS.uploads, row.audio_path, local))) {
      throw new Error("The uploaded voiceover could not be found; upload it again");
    }
    const stat = await fsp.stat(local);
    if (stat.size > LIMITS.maxUploadAudioBytes) throw new Error("The voiceover is larger than 25 MB");
    const seconds = await (deps.media ?? defaultMedia).probeDuration(local);
    if (seconds > LIMITS.maxUploadAudioSec) throw new Error("The voiceover is longer than 5 minutes");
  }
  return project;
}

/** Copies narration and prompt edits made in the scene editor into the manifest. */
export function applySceneEdits(project: Project, rows: SceneRow[]): void {
  for (const row of rows) {
    const scene = project.manifest.scenes[row.index];
    if (!scene) continue;
    if (row.narration.trim() && row.narration !== scene.narration) {
      scene.narration = row.narration.trim();
      delete scene.words; // re-timed by the next voice stage (or estimated)
    }
    if (row.image_prompt.trim() && row.image_prompt !== scene.imagePrompt)
      scene.imagePrompt = row.image_prompt.trim();
  }
}

async function dropSceneFiles(project: Project, index: number, kind: "image" | "voice"): Promise<void> {
  const scene = project.manifest.scenes[index];
  if (!scene) throw new Error(`Scene ${index} does not exist`);
  const files =
    kind === "image"
      ? [
          project.path("images", sceneFileName(index, "png")),
          project.path("animated", sceneFileName(index, "mp4")),
          project.path("animated", `${sceneFileName(index, "mp4")}.upload.json`),
        ]
      : [
          project.path("audio", sceneFileName(index, "mp3")),
          project.path("audio", sceneFileName(index, "words.json")),
        ];
  await Promise.all(files.map((f) => fsp.rm(f, { force: true })));
  if (kind === "image") {
    delete scene.imagePath;
    delete scene.videoPath;
  } else {
    delete scene.audioPath;
    delete scene.durationSec;
    delete scene.words;
  }
  await project.save();
}

/** Thumbnail job: new headline and/or a new picture; the stage then redoes only what is missing. */
async function prepareThumbnail(
  project: Project,
  data: Extract<ProjectJob, { type: "thumbnail" }>,
): Promise<void> {
  const thumb = project.manifest.thumbnails?.[data.index];
  if (!thumb) throw new Error("This video has no thumbnails yet; render it first");
  if (data.headline) thumb.headline = data.headline;
  const files = thumbnailFiles(data.index);
  const drop = [files.output, files.clean, ...(data.redraw ? [files.image] : [])];
  await Promise.all(drop.map((f) => fsp.rm(project.abs(f), { force: true })));
  if (data.redraw) {
    // A different seed gives a different picture from the same idea.
    thumb.seed = thumbnailSeed(thumb.seed, 0, 1);
    delete thumb.imagePath;
  }
  delete thumb.outputPath;
  delete thumb.cleanPath;
  await project.save();
}

export function sceneRows(project: Project, prefix: string): SceneInput[] {
  const stored = (rel?: string) => (rel ? `${prefix}/${rel}` : null);
  return project.manifest.scenes.map((s) => ({
    index: s.index,
    narration: s.narration,
    visual: s.visual,
    image_prompt: s.imagePrompt,
    motion: s.motion,
    duration_sec: s.durationSec ?? null,
    audio_path: stored(s.audioPath),
    image_path: stored(s.imagePath),
    video_path: stored(s.videoPath),
  }));
}

/** Short, user-facing error text (no stack traces). */
function publicError(err: unknown): string {
  return errorMessage(err).split("\n")[0]!.slice(0, 500);
}

/**
 * Runs one project job: download the project's files, run the pipeline stages the
 * job needs, upload what changed, and record status, scenes and output in the DB.
 */
export async function runProjectJob(data: ProjectJob, deps: WorkerDeps): Promise<void> {
  const row = await deps.projects.getProject(data.projectId);
  if (!row) return; // deleted meanwhile
  const log = (deps.log ?? createLogger({})).child({ project: row.id, job: data.type });
  const prefix = assetsPrefix(row.user_id, row.id);
  const workDir = await fsp.mkdtemp(path.join(deps.workRoot ?? os.tmpdir(), "inkcut-job-"));
  const projectDir = path.join(workDir, row.id);
  const counter = new ApiCallCounter();
  let project: Project | undefined;
  let snapshot = new Map<string, number>();

  try {
    await deps.projects.updateProject(row.id, { status: "queued", error: null });
    snapshot = await hydrate(deps.assets, prefix, projectDir);
    project = snapshot.has(MANIFEST_FILE)
      ? await Project.load(workDir, row.id)
      : await createLocalProject(row, workDir, deps);
    project.manifest.animate = row.animate ? { enabled: true } : undefined;
    applySceneEdits(project, await deps.projects.listScenes(row.id));
    if (data.type === "redraw") await dropSceneFiles(project, data.sceneIndex, "image");
    if (data.type === "revoice") await dropSceneFiles(project, data.sceneIndex, "voice");
    if (data.type === "thumbnail") await prepareThumbnail(project, data);
    await project.save();

    log.info("job started");
    const result = await runPipeline({
      project,
      providers: deps.providers(counter, log),
      counter,
      log,
      ...(deps.media ? { media: deps.media } : {}),
      ...(ONLY[data.type] ? { only: ONLY[data.type]! } : {}),
      onStage: (stage) =>
        deps.projects.updateProject(row.id, {
          status: STAGE_STATUS[stage],
          current_stage: stage,
          error: null,
        }),
    });

    await persist(deps.assets, prefix, projectDir, snapshot);
    await deps.projects.replaceScenes(row.id, sceneRows(project, prefix));
    // Only jobs that ran the render stage produced a new MP4 (redraw/revoice wait for a render).
    const rendered = data.type === "generate" || data.type === "render";
    if (rendered && result.outputPath) {
      const out = outputPath(row.user_id, row.id);
      await deps.assets.upload(BUCKETS.outputs, out, result.outputPath, "video/mp4");
      const expires = new Date(
        (deps.now?.() ?? new Date()).getTime() + LIMITS.outputRetentionHours * 3600_000,
      );
      await deps.projects.updateProject(row.id, {
        output_path: out,
        output_expires_at: expires.toISOString(),
      });
    }
    await deps.projects.updateProject(row.id, {
      status: doneStatus(data, row),
      current_stage: null,
      error: null,
    });
    log.info("job done", { apiCalls: counter.snapshot() });
  } catch (err) {
    log.error("job failed", { error: errorMessage(err) });
    // Keep whatever finished so a retry resumes instead of paying again.
    try {
      if (project) {
        await persist(deps.assets, prefix, projectDir, snapshot);
        await deps.projects.replaceScenes(row.id, sceneRows(project, prefix));
      }
    } catch (saveErr) {
      log.warn("could not save partial progress", { error: errorMessage(saveErr) });
    }
    await deps.projects.updateProject(row.id, { status: "failed", error: publicError(err) });
    throw err;
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

/** Spec §8: delete outputs and working files 48 h after a video was rendered. */
export async function runCleanup(deps: WorkerDeps): Promise<number> {
  const log = deps.log ?? createLogger({ job: "cleanup" });
  const now = (deps.now?.() ?? new Date()).toISOString();
  let cleaned = 0;
  for (;;) {
    const expired = await deps.projects.listExpired(now, 50);
    if (expired.length === 0) break;
    for (const p of expired) {
      await deps.assets.remove(BUCKETS.outputs, [outputPath(p.user_id, p.id)]);
      await removeAssets(deps.assets, assetsPrefix(p.user_id, p.id));
      if (p.audio_path) await deps.assets.remove(BUCKETS.uploads, [p.audio_path]);
      await deps.projects.updateProject(p.id, { status: "expired", output_path: null });
      cleaned++;
    }
  }
  if (cleaned) log.info("cleanup removed expired projects", { count: cleaned });
  return cleaned;
}

export async function handleJob(data: JobData, deps: WorkerDeps): Promise<void> {
  if (data.type === "cleanup") {
    await runCleanup(deps);
    return;
  }
  await runProjectJob(data, deps);
}
