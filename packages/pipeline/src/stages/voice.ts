import { z } from "zod";
import { WordTimingSchema } from "@inkcut/shared";
import { sceneFileName } from "../project.js";
import { alignWords } from "../timing.js";
import { mapLimit } from "../util/concurrency.js";
import { fileExists, readJson, writeJson } from "../util/fs.js";
import { checkForcedFailure, type StageContext } from "./context.js";

const WordsFileSchema = z.array(WordTimingSchema);
const TTS_CONCURRENCY = 3;

/** Stage 4 (text modes): one TTS file per scene + exact duration from ffprobe. */
export async function runVoiceStage(ctx: StageContext): Promise<void> {
  const { project, log } = ctx;
  const scenes = project.manifest.scenes;
  const voiceId = project.manifest.voiceId;
  let newItems = 0;
  let done = 0;
  const concurrency = ctx.failAt?.stage === "voice" ? 1 : TTS_CONCURRENCY;

  await mapLimit(scenes, concurrency, async (scene) => {
    const audioFile = project.path("audio", sceneFileName(scene.index, "mp3"));
    const wordsFile = project.path("audio", sceneFileName(scene.index, "words.json"));
    let rawWords;
    if ((await fileExists(audioFile)) && (await fileExists(wordsFile))) {
      rawWords = WordsFileSchema.parse(await readJson(wordsFile));
    } else {
      checkForcedFailure(ctx, "voice", newItems);
      const result = await ctx.providers.tts().synthesize(scene.narration, voiceId, audioFile);
      rawWords = result.words;
      await writeJson(wordsFile, rawWords);
      newItems++;
    }
    const durationSec = await ctx.media.probeDuration(audioFile);
    scene.audioPath = project.rel(audioFile);
    scene.durationSec = durationSec;
    scene.words = alignWords(scene.narration, rawWords, { start: 0, end: durationSec });
    await project.save();
    done++;
    log.info(`voice ${done}/${scenes.length}`, { scene: scene.index, sec: durationSec.toFixed(2) });
  });
  log.info("voice done", { newFiles: newItems, reused: scenes.length - newItems });
}
