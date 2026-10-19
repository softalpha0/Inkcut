import { IMAGE_SIZES, LIMITS, ThumbnailPlanSchema, type Thumbnail } from "@inkcut/shared";
import { thumbnailMessages } from "../llm/prompts.js";
import { completeJson } from "../llm/structured.js";
import { buildImagePrompt } from "../styles/index.js";
import { mapLimit } from "../util/concurrency.js";
import { fileExists } from "../util/fs.js";
import { checkForcedFailure, type StageContext } from "./context.js";

export const THUMBNAILS_DIR = "thumbnails";
/** Narration sent to the LLM for thumbnail ideas, characters. */
const NARRATION_CHARS = 2500;

export function thumbnailFiles(index: number): { image: string; output: string; clean: string } {
  const n = index + 1;
  return {
    image: `${THUMBNAILS_DIR}/thumb-${n}.png`,
    output: `${THUMBNAILS_DIR}/thumb-${n}.jpg`,
    clean: `${THUMBNAILS_DIR}/thumb-${n}-clean.jpg`,
  };
}

/** Distinct, stable seed per thumbnail so the three pictures differ from each other. */
export function thumbnailSeed(projectSeed: number, index: number, attempt = 0): number {
  return (projectSeed + 7919 * (index + 1) + 104_729 * attempt) % 2_147_483_647;
}

/** A short title for the LLM: the topic, or the opening of the narration. */
function videoTitle(ctx: StageContext): string {
  const m = ctx.project.manifest;
  if (m.input.mode === "topic") return m.input.topic;
  return (m.scenes[0]?.narration ?? "Explainer video").slice(0, 120);
}

/**
 * Stage 7: three YouTube thumbnails (spec §5.5). Headlines and picture ideas
 * from the LLM, pictures from the image provider in the video's style (always
 * 16:9), headline burned in with FFmpeg. Each piece is kept once made.
 */
export async function runThumbnailStage(ctx: StageContext): Promise<void> {
  const { project, log, style } = ctx;
  const m = project.manifest;
  if (m.scenes.length === 0) throw new Error("Plan the video before making thumbnails");

  if (!m.thumbnails?.length) {
    checkForcedFailure(ctx, "thumbnail", 0);
    log.info("writing thumbnail ideas with SERV");
    const narration = m.scenes
      .map((s) => s.narration)
      .join(" ")
      .slice(0, NARRATION_CHARS);
    const plan = await completeJson(
      ctx.providers.llm(),
      thumbnailMessages(videoTitle(ctx), narration, style, m.characters),
      ThumbnailPlanSchema,
      { log, label: "thumbnail" },
    );
    m.thumbnails = plan.thumbnails.slice(0, LIMITS.thumbnailsPerVideo).map((t, index): Thumbnail => ({
      index,
      headline: t.headline,
      imagePrompt: t.imagePrompt,
      seed: thumbnailSeed(m.seed, index),
    }));
    await project.save();
  }

  const size = IMAGE_SIZES["16:9"];
  const thumbs = m.thumbnails;
  let newImages = 0;
  // Pictures in parallel (network); the text pass one at a time (local FFmpeg, shared font folder).
  await mapLimit(thumbs, LIMITS.thumbnailsPerVideo, async (thumb) => {
    const files = thumbnailFiles(thumb.index);
    const imageFile = project.path(...files.image.split("/"));
    if (!(await fileExists(imageFile))) {
      checkForcedFailure(ctx, "thumbnail", newImages);
      await ctx.providers.images().generate({
        prompt: buildImagePrompt(style, thumb.imagePrompt, m.characters),
        negativePrompt: style.negativePrompt,
        width: size.width,
        height: size.height,
        seed: thumb.seed,
        outFile: imageFile,
      });
      newImages++;
    }
    thumb.imagePath = files.image;
    await project.save();
  });

  for (const thumb of thumbs) {
    const files = thumbnailFiles(thumb.index);
    const outFile = project.path(...files.output.split("/"));
    const cleanFile = project.path(...files.clean.split("/"));
    if (!(await fileExists(outFile)) || !(await fileExists(cleanFile))) {
      await ctx.media.renderThumbnail({
        projectDir: project.dir,
        imagePath: project.abs(files.image),
        headline: thumb.headline,
        fontsDir: ctx.fontsDir,
        outFile,
        cleanFile,
      });
    }
    thumb.outputPath = files.output;
    thumb.cleanPath = files.clean;
    await project.save();
    log.info(`thumbnail ${thumb.index + 1}/${thumbs.length}`, { headline: thumb.headline });
  }
  log.info("thumbnails done", { newImages });
}
