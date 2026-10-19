import { FPS, RESOLUTIONS, SCENE_GAP_SEC, type WordTiming } from "@inkcut/shared";
import { buildCaptionLines, estimateWordTimings, type CaptionLine } from "../render/captions.js";
import type { NarrationSource } from "../render/compose.js";
import { timelineFromDurations, timelineFromStarts, type TimelineEntry } from "../timing.js";
import { fileExists } from "../util/fs.js";
import { checkForcedFailure, type StageContext } from "./context.js";

/** Hold on the last frame after the narration ends (text modes). */
export const END_TAIL_SEC = 0.6;
export const FINAL_FILE = "final.mp4";

/** Stage 6: images + audio + captions → final.mp4 (FFmpeg). No paid calls; always re-runs. */
export async function runRenderStage(ctx: StageContext): Promise<void> {
  const { project, log } = ctx;
  const m = project.manifest;
  const { width, height } = RESOLUTIONS[m.aspect];
  checkForcedFailure(ctx, "render", 0);

  for (const s of m.scenes) {
    if (!s.imagePath) throw new Error(`Scene ${s.index} has no image; run the draw stage first`);
  }

  let timeline: TimelineEntry[];
  let narration: NarrationSource;
  /** Absolute start (seconds) of each scene's words in the final narration track. */
  let wordOffsets: number[];

  if (m.input.mode === "audio") {
    const audioFile = project.abs(m.input.audioFile);
    const totalSec = await ctx.media.probeDuration(audioFile);
    const starts = m.scenes.map((s) => s.startSec ?? 0);
    timeline = timelineFromStarts(starts, totalSec, FPS);
    narration = {
      kind: "single",
      path: audioFile,
      totalSec: timeline.reduce((a, t) => a + t.durationSec, 0),
    };
    wordOffsets = starts;
  } else {
    const durations = m.scenes.map((s) => {
      if (!s.durationSec || !s.audioPath)
        throw new Error(`Scene ${s.index} has no audio; run the voice stage first`);
      return s.durationSec;
    });
    timeline = timelineFromDurations(durations, SCENE_GAP_SEC, END_TAIL_SEC, FPS);
    narration = {
      kind: "scenes",
      files: m.scenes.map((s, i) => ({ path: project.abs(s.audioPath!), slotSec: timeline[i]!.durationSec })),
    };
    wordOffsets = timeline.map((t) => t.startSec);
  }

  let captionLines: CaptionLine[] | undefined;
  if (m.captions) {
    const words: WordTiming[] = m.scenes.flatMap((s, i) => {
      const offset = wordOffsets[i]!;
      const local = s.words?.length
        ? s.words
        : estimateWordTimings(s.narration, 0, s.durationSec ?? timeline[i]!.durationSec);
      return local.map((w) => ({ text: w.text, start: w.start + offset, end: w.end + offset }));
    });
    captionLines = buildCaptionLines(words, { maxChars: m.aspect === "9:16" ? 22 : 32 });
  }

  // Animated clips (from --animate) replace zoom/pan for their scenes.
  const videoInfo = await Promise.all(
    m.scenes.map(async (s) => {
      if (!s.videoPath) return undefined;
      const file = project.abs(s.videoPath);
      if (!(await fileExists(file))) return undefined;
      return { path: file, durationSec: await ctx.media.probeDuration(file) };
    }),
  );

  const totalSec = timeline.reduce((a, t) => a + t.durationSec, 0);
  log.info("rendering video", {
    scenes: m.scenes.length,
    animated: videoInfo.filter(Boolean).length,
    seconds: totalSec.toFixed(1),
    resolution: `${width}x${height}`,
  });
  const out = await ctx.media.renderVideo({
    projectDir: project.dir,
    scenes: m.scenes.map((s, i) => ({
      index: s.index,
      imagePath: project.abs(s.imagePath!),
      motion: s.motion,
      frames: timeline[i]!.frames,
      startSec: timeline[i]!.startSec,
      ...(videoInfo[i] ? { videoPath: videoInfo[i]!.path, videoDurationSec: videoInfo[i]!.durationSec } : {}),
    })),
    width,
    height,
    fps: FPS,
    narration,
    ...(captionLines ? { captions: { lines: captionLines, ass: { width, height, aspect: m.aspect } } } : {}),
    fontsDir: ctx.fontsDir,
    outFile: project.path(FINAL_FILE),
    log,
  });
  m.outputPath = project.rel(out);
  await project.save();
  log.info("render done", { output: out });
}
