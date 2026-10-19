import fsp from "node:fs/promises";
import { SceneSchema, makeScenePlanSchema, type Scene, type WordTiming } from "@inkcut/shared";
import { z } from "zod";
import { planMessages } from "../llm/prompts.js";
import { completeJson } from "../llm/structured.js";
import { alignWords, chunkTokens, tokenize } from "../timing.js";
import { fileExists, readJson, writeJson } from "../util/fs.js";
import { checkForcedFailure, type StageContext } from "./context.js";
import { SCRIPT_FILE } from "./script.js";
import { loadTranscript } from "./transcribe.js";

export const PLAN_FILE = "plan.json";

const PlanFileSchema = z.object({
  characters: z.string(),
  scenes: z.array(SceneSchema).min(1),
});

interface Chunk {
  narration: string;
  /** Audio mode only. */
  startSec?: number;
  words?: WordTiming[];
}

/** Text modes: split the script into scene-sized narration chunks. */
export function chunksFromScript(script: string): Chunk[] {
  const tokens = tokenize(script);
  return chunkTokens(tokens).map((r) => ({ narration: tokens.slice(r.start, r.end).join(" ") }));
}

/**
 * Audio mode: align the transcript text (with punctuation) to Whisper's word
 * timestamps, then cut scenes on the same sentence boundaries as text modes.
 * Scene 0 starts at 0 so leading silence stays in the video.
 */
export function chunksFromTranscript(text: string, words: WordTiming[], durationSec: number): Chunk[] {
  const aligned = alignWords(text, words, { start: 0, end: durationSec });
  const ranges = chunkTokens(aligned.map((w) => w.text));
  return ranges.map((r, i) => {
    const slice = aligned.slice(r.start, r.end);
    const startSec = i === 0 ? 0 : slice[0]!.start;
    return {
      narration: slice.map((w) => w.text).join(" "),
      startSec,
      words: slice.map((w) => ({ text: w.text, start: w.start - startSec, end: w.end - startSec })),
    };
  });
}

/** Stage 3: narration → Scene[] with image prompts (SERV, zod-validated). */
export async function runPlanStage(ctx: StageContext): Promise<void> {
  const { project, log } = ctx;
  const planFile = project.path(PLAN_FILE);

  if (await fileExists(planFile)) {
    const saved = PlanFileSchema.parse(await readJson(planFile));
    if (project.manifest.scenes.length === 0) {
      project.manifest.scenes = saved.scenes;
      project.manifest.characters = saved.characters;
      await project.save();
    }
    log.info("plan.json exists, skipping", { scenes: saved.scenes.length });
    return;
  }

  const chunks =
    project.manifest.input.mode === "audio"
      ? await (async () => {
          const t = await loadTranscript(ctx);
          return chunksFromTranscript(t.text, t.words, t.durationSec);
        })()
      : chunksFromScript(await fsp.readFile(project.path(SCRIPT_FILE), "utf8"));
  if (chunks.length === 0) throw new Error("The script is empty; nothing to plan");

  checkForcedFailure(ctx, "plan", 0);
  log.info("planning scenes with SERV", { scenes: chunks.length });
  const plan = await completeJson(
    ctx.providers.llm(),
    planMessages(
      chunks.map((c) => c.narration),
      ctx.style,
    ),
    makeScenePlanSchema(chunks.length),
    { log, label: "plan" },
  );

  const scenes: Scene[] = chunks.map((chunk, i) => {
    const planned = plan.scenes[i]!;
    return SceneSchema.parse({
      index: i,
      narration: chunk.narration,
      visual: planned.visual,
      imagePrompt: planned.imagePrompt,
      motion: planned.motion,
      ...(planned.animationPrompt ? { animationPrompt: planned.animationPrompt } : {}),
      ...(chunk.startSec !== undefined ? { startSec: chunk.startSec } : {}),
      ...(chunk.words ? { words: chunk.words } : {}),
    });
  });

  await writeJson(planFile, { characters: plan.characters, scenes });
  project.manifest.scenes = scenes;
  project.manifest.characters = plan.characters;
  await project.save();
  log.info("planned", { scenes: scenes.length });
}
