import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Motion } from "@inkcut/shared";
import { fileExists, readJson, writeFileAtomic, writeJson } from "../util/fs.js";
import { runFfmpeg } from "../util/ffmpeg.js";
import type { Logger } from "../util/log.js";
import { mapLimit } from "../util/concurrency.js";
import { buildAss, type AssOptions, type CaptionLine } from "./captions.js";
import { animatedSceneFilter, sceneFilter } from "./motion.js";

export interface RenderScene {
  index: number;
  /** Absolute path. */
  imagePath: string;
  motion: Motion;
  frames: number;
  /** Where the scene starts in the final video, seconds (frame-exact). */
  startSec: number;
  /** Animated clip (absolute path) used instead of zoom/pan on the still image. */
  videoPath?: string;
  /** Length of that clip, seconds (from ffprobe). */
  videoDurationSec?: number;
}

export type NarrationSource =
  /** TTS modes: one file per scene, each padded/trimmed to its slot. */
  | { kind: "scenes"; files: { path: string; slotSec: number }[] }
  /** Audio mode: the uploaded voiceover, padded/trimmed to the video length. */
  | { kind: "single"; path: string; totalSec: number };

export interface RenderJob {
  projectDir: string;
  scenes: RenderScene[];
  width: number;
  height: number;
  fps: number;
  narration: NarrationSource;
  /** Caption lines in absolute video time; omit for no captions. */
  captions?: { lines: CaptionLine[]; ass: AssOptions };
  /** Folder of .ttf files for libass. */
  fontsDir: string;
  outFile: string;
  log: Logger;
  concurrency?: number;
}

const CLIP_CACHE_VERSION = 3;

async function clipKey(scene: RenderScene, job: RenderJob, sceneAss: string | undefined): Promise<string> {
  const source = scene.videoPath ?? scene.imagePath;
  const stat = await fsp.stat(source);
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        v: CLIP_CACHE_VERSION,
        source: path.basename(source),
        size: stat.size,
        mtime: Math.round(stat.mtimeMs),
        motion: scene.motion,
        frames: scene.frames,
        w: job.width,
        h: job.height,
        fps: job.fps,
        ass: sceneAss ?? null,
      }),
    )
    .digest("hex");
}

/**
 * Captions for one clip: lines overlapping the scene, shifted to clip time and
 * clamped to it. A line spanning a cut is drawn in both clips, so it shows
 * continuously in the final video.
 */
export function sceneCaptionLines(
  lines: CaptionLine[],
  startSec: number,
  durationSec: number,
): CaptionLine[] {
  const end = startSec + durationSec;
  return lines
    .filter((l) => l.end > startSec && l.start < end)
    .map((l) => ({
      text: l.text,
      start: Math.max(0, l.start - startSec),
      end: Math.min(durationSec, l.end - startSec),
    }));
}

/** Relative path with forward slashes, for ffmpeg args run with cwd = project dir. */
function rel(projectDir: string, p: string): string {
  return path.relative(projectDir, p).split(path.sep).join("/");
}

async function renderClip(scene: RenderScene, job: RenderJob, clipsDir: string): Promise<string> {
  const name = String(scene.index).padStart(3, "0");
  const out = path.join(clipsDir, `${name}.mp4`);
  const keyFile = path.join(clipsDir, `${name}.json`);
  const sceneAss = job.captions
    ? buildAss(
        sceneCaptionLines(job.captions.lines, scene.startSec, scene.frames / job.fps),
        job.captions.ass,
      )
    : undefined;
  const key = await clipKey(scene, job, sceneAss);
  if ((await fileExists(out)) && (await fileExists(keyFile))) {
    const cached = (await readJson(keyFile)) as { key?: string };
    if (cached.key === key) return out;
  }

  let vf =
    scene.videoPath && scene.videoDurationSec
      ? animatedSceneFilter(scene.videoDurationSec, scene.frames, job.width, job.height, job.fps)
      : sceneFilter(scene.motion, scene.frames, job.width, job.height, job.fps);
  if (sceneAss !== undefined) {
    const assFile = path.join(clipsDir, `${name}.ass`);
    await writeFileAtomic(assFile, sceneAss);
    // Relative paths keep Windows drive letters ("C:") out of the filter string.
    vf += `,subtitles=${rel(job.projectDir, assFile)}:fontsdir=${rel(job.projectDir, path.join(job.projectDir, "render", "fonts"))}`;
  }

  const tmp = path.join(clipsDir, `${name}.tmp.mp4`);
  await runFfmpeg(
    [
      "-i",
      rel(job.projectDir, scene.videoPath ?? scene.imagePath),
      "-vf",
      vf,
      "-frames:v",
      String(scene.frames),
      "-r",
      String(job.fps),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-an",
      rel(job.projectDir, tmp),
    ],
    { cwd: job.projectDir },
  );
  await fsp.rename(tmp, out);
  await writeJson(keyFile, { key });
  return out;
}

async function renderNarration(job: RenderJob, outFile: string): Promise<void> {
  // Stereo (the same voice on both sides): some players and Bluetooth devices play mono on one side only.
  const common = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];
  const tmp = outFile.replace(/\.m4a$/, ".tmp.m4a");
  if (job.narration.kind === "single") {
    await runFfmpeg(
      [
        "-i",
        rel(job.projectDir, job.narration.path),
        "-vn",
        "-af",
        `aresample=48000,apad,atrim=end=${job.narration.totalSec.toFixed(6)}`,
        ...common,
        rel(job.projectDir, tmp),
      ],
      { cwd: job.projectDir },
    );
  } else {
    const files = job.narration.files;
    const inputs = files.flatMap((f) => ["-i", rel(job.projectDir, f.path)]);
    const pads = files
      .map(
        (f, i) =>
          `[${i}:a]aresample=48000,aformat=channel_layouts=mono,apad,atrim=end=${f.slotSec.toFixed(6)},asetpts=N/SR/TB[a${i}]`,
      )
      .join(";");
    const concat = `${files.map((_, i) => `[a${i}]`).join("")}concat=n=${files.length}:v=0:a=1[out]`;
    await runFfmpeg(
      [
        ...inputs,
        "-filter_complex",
        `${pads};${concat}`,
        "-map",
        "[out]",
        ...common,
        rel(job.projectDir, tmp),
      ],
      { cwd: job.projectDir },
    );
  }
  await fsp.rename(tmp, outFile);
}

/**
 * Spec §5.4: per-scene zoompan clips with that scene's captions burned in →
 * concat demuxer → narration track → H.264/AAC with +faststart.
 */
export async function renderVideo(job: RenderJob): Promise<string> {
  const renderDir = path.join(job.projectDir, "render");
  const clipsDir = path.join(renderDir, "clips");
  await fsp.mkdir(clipsDir, { recursive: true });

  if (job.captions) {
    // Full-video .ass kept alongside the MP4 (handy for checking timing or re-use as subtitles).
    await writeFileAtomic(
      path.join(renderDir, "captions.ass"),
      buildAss(job.captions.lines, job.captions.ass),
    );
    const fontsLocal = path.join(renderDir, "fonts");
    await fsp.mkdir(fontsLocal, { recursive: true });
    for (const f of await fsp.readdir(job.fontsDir)) {
      if (f.toLowerCase().endsWith(".ttf"))
        await fsp.copyFile(path.join(job.fontsDir, f), path.join(fontsLocal, f));
    }
  }

  const concurrency = job.concurrency ?? Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
  let done = 0;
  const clips = await mapLimit(job.scenes, concurrency, async (scene) => {
    const clip = await renderClip(scene, job, clipsDir);
    done++;
    job.log.info(`clip ${done}/${job.scenes.length}`, { scene: scene.index, frames: scene.frames });
    return clip;
  });

  const listFile = path.join(renderDir, "clips.txt");
  // Paths in a concat list are relative to the list file.
  await writeFileAtomic(listFile, clips.map((c) => `file '${rel(renderDir, c)}'`).join("\n") + "\n");

  const narrationFile = path.join(renderDir, "narration.m4a");
  job.log.info("mixing narration track");
  await renderNarration(job, narrationFile);

  // Clips already carry motion and captions: the final pass only copies video and adds audio.
  job.log.info("muxing final.mp4");
  const tmpOut = job.outFile.replace(/\.mp4$/, ".tmp.mp4");
  await runFfmpeg(
    [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      rel(job.projectDir, listFile),
      "-i",
      rel(job.projectDir, narrationFile),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      "-shortest",
      rel(job.projectDir, tmpOut),
    ],
    { cwd: job.projectDir },
  );
  await fsp.rename(tmpOut, job.outFile);
  return job.outFile;
}
