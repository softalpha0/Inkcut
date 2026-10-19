import fsp from "node:fs/promises";
import { FPS, LIMITS, SCENE_GAP_SEC, type Scene } from "@inkcut/shared";
import { sceneFileName } from "../project.js";
import { mapLimit } from "../util/concurrency.js";
import { fileExists } from "../util/fs.js";
import { errorMessage, statusOf } from "../util/retry.js";
import type { VideoModelInfo } from "../video/types.js";
import { checkForcedFailure, type StageContext } from "./context.js";

const ANIMATE_CONCURRENCY = 3;

/** Seconds of video a scene needs: its audio plus the gap (text modes) or its timestamp span (audio mode). */
export function sceneSlotSec(scenes: Scene[], i: number, totalAudioSec?: number): number {
  const s = scenes[i]!;
  if (s.startSec !== undefined) {
    const next = scenes[i + 1]?.startSec ?? totalAudioSec ?? s.startSec + (s.durationSec ?? 5);
    return Math.max(0.5, next - s.startSec);
  }
  return (s.durationSec ?? 5) + SCENE_GAP_SEC;
}

/** Whole seconds to request: the scene length rounded up, kept inside the model's limits. */
export function clipDurationSec(slotSec: number, info: VideoModelInfo): number {
  return Math.min(info.maxDurationSec, Math.max(info.minDurationSec, Math.ceil(slotSec - 1 / FPS)));
}

/** Indexes of the scenes to animate when capped: spread evenly through the video. */
export function pickScenes(count: number, max: number | undefined): number[] {
  const n = Math.min(count, max ?? count, LIMITS.maxAnimatedScenesPerVideo);
  if (n >= count) return Array.from({ length: count }, (_, i) => i);
  return Array.from({ length: n }, (_, k) => Math.round((k * (count - 1)) / Math.max(1, n - 1)));
}

/** Prompt for the video model; falls back to the scene description for older plans. */
export function animationPromptFor(scene: Scene): string {
  const base =
    scene.animationPrompt ?? `${scene.visual} Subtle natural movement, characters gesture slightly.`;
  return `${base} Keep the hand-drawn stickman style and white background, camera mostly still, no text.`;
}

/** Auth, permission and budget errors stop the stage; other failures fall back to zoom/pan for that scene. */
function isAccountError(err: unknown): boolean {
  const status = statusOf(err);
  return status === 401 || status === 402 || status === 403;
}

/**
 * Optional stage (--animate): turns scene images into short clips with an
 * image-to-video model. Existing clips are kept, so a resume never pays twice.
 */
export async function runAnimateStage(ctx: StageContext): Promise<void> {
  const { project, log } = ctx;
  const settings = project.manifest.animate;
  if (!settings?.enabled) {
    log.info("animation off (use --animate to animate scenes)");
    return;
  }
  const scenes = project.manifest.scenes;
  const chosen = new Set(pickScenes(scenes.length, settings.maxScenes));
  const provider = ctx.providers.video();
  const info = await provider.describe();

  const todo: { scene: Scene; durationSec: number; outFile: string }[] = [];
  let estimateSec = 0;
  for (const [i, scene] of scenes.entries()) {
    if (!chosen.has(i)) continue;
    const outFile = project.path("animated", sceneFileName(scene.index, "mp4"));
    if (await fileExists(outFile)) {
      scene.videoPath = project.rel(outFile);
      continue;
    }
    const durationSec = clipDurationSec(sceneSlotSec(scenes, i), info);
    todo.push({ scene, durationSec, outFile });
    estimateSec += durationSec;
  }

  const price = info.pricePerSec;
  log.info(`animating ${todo.length} scene(s) with ${info.model}`, {
    alreadyDone: chosen.size - todo.length,
    videoSeconds: estimateSec,
    estimatedPollen: price !== undefined ? (estimateSec * price).toFixed(3) : "unknown",
  });

  let newItems = 0;
  let done = 0;
  const failed: number[] = [];
  const concurrency = ctx.failAt?.stage === "animate" ? 1 : ANIMATE_CONCURRENCY;
  await mapLimit(todo, concurrency, async ({ scene, durationSec, outFile }) => {
    checkForcedFailure(ctx, "animate", newItems);
    try {
      await provider.animate({
        imageFile: project.abs(scene.imagePath!),
        prompt: animationPromptFor(scene),
        durationSec,
        outFile,
      });
      scene.videoPath = project.rel(outFile);
      newItems++;
    } catch (err) {
      if (isAccountError(err)) throw err;
      await fsp.rm(outFile, { force: true });
      failed.push(scene.index);
      log.warn(`scene ${scene.index} could not be animated; it keeps zoom/pan`, { error: errorMessage(err) });
    }
    await project.save();
    done++;
    log.info(`animate ${done}/${todo.length}`, { scene: scene.index, sec: durationSec });
  });
  log.info("animate done", { newClips: newItems, failed: failed.length });
}
