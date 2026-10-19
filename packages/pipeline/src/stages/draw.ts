import { IMAGE_SIZES } from "@inkcut/shared";
import { sceneFileName } from "../project.js";
import { buildImagePrompt } from "../styles/index.js";
import { mapLimit } from "../util/concurrency.js";
import { fileExists } from "../util/fs.js";
import { checkForcedFailure, type StageContext } from "./context.js";

const DRAW_CONCURRENCY = 4;

/** Stage 5: one image per scene (image provider + style preset). Existing images are kept. */
export async function runDrawStage(ctx: StageContext): Promise<void> {
  const { project, log, style } = ctx;
  const { scenes, aspect, seed, characters } = project.manifest;
  const size = IMAGE_SIZES[aspect];
  let newItems = 0;
  let done = 0;
  const concurrency = ctx.failAt?.stage === "draw" ? 1 : DRAW_CONCURRENCY;

  await mapLimit(scenes, concurrency, async (scene) => {
    const imageFile = project.path("images", sceneFileName(scene.index, "png"));
    if (!(await fileExists(imageFile))) {
      checkForcedFailure(ctx, "draw", newItems);
      await ctx.providers.images().generate({
        prompt: buildImagePrompt(style, scene.imagePrompt, characters),
        negativePrompt: style.negativePrompt,
        width: size.width,
        height: size.height,
        seed,
        outFile: imageFile,
      });
      newItems++;
    }
    scene.imagePath = project.rel(imageFile);
    await project.save();
    done++;
    log.info(`draw ${done}/${scenes.length}`, { scene: scene.index });
  });
  log.info("draw done", { newImages: newItems, reused: scenes.length - newItems });
}
