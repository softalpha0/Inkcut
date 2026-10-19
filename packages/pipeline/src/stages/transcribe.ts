import { z } from "zod";
import { WordTimingSchema } from "@inkcut/shared";
import { fileExists, readJson, writeFileAtomic, writeJson } from "../util/fs.js";
import { checkForcedFailure, type StageContext } from "./context.js";
import { SCRIPT_FILE } from "./script.js";

export const TRANSCRIPT_FILE = "transcript.json";

export const TranscriptSchema = z.object({
  text: z.string().min(1),
  durationSec: z.number().positive(),
  words: z.array(WordTimingSchema).min(1),
});
export type TranscriptFile = z.infer<typeof TranscriptSchema>;

export async function loadTranscript(ctx: StageContext): Promise<TranscriptFile> {
  return TranscriptSchema.parse(await readJson(ctx.project.path(TRANSCRIPT_FILE)));
}

/** Stage 2 (audio mode): uploaded voiceover → text + word timestamps (Whisper). */
export async function runTranscribeStage(ctx: StageContext): Promise<void> {
  const { project, log } = ctx;
  const input = project.manifest.input;
  if (input.mode !== "audio") throw new Error("transcribe stage needs an audio project");
  if (await fileExists(project.path(TRANSCRIPT_FILE))) {
    log.info("transcript.json exists, skipping");
    return;
  }
  checkForcedFailure(ctx, "transcribe", 0);
  log.info("transcribing voiceover", { file: input.audioFile });
  const t = await ctx.providers.stt().transcribe(project.abs(input.audioFile));
  const transcript = TranscriptSchema.parse(t);
  await writeJson(project.path(TRANSCRIPT_FILE), transcript);
  await writeFileAtomic(project.path(SCRIPT_FILE), transcript.text + "\n");
  log.info("transcribed", { words: transcript.words.length, durationSec: transcript.durationSec.toFixed(1) });
}
