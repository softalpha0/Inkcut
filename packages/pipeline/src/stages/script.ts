import fsp from "node:fs/promises";
import { LIMITS } from "@inkcut/shared";
import { z } from "zod";
import { scriptMessages } from "../llm/prompts.js";
import { completeValidated } from "../llm/structured.js";
import { countWords, targetWordCount } from "../timing.js";
import { fileExists, writeFileAtomic } from "../util/fs.js";
import { checkForcedFailure, type StageContext } from "./context.js";

export const SCRIPT_FILE = "script.txt";

/** Strips markdown, headings and wrapping quotes an LLM might add despite instructions. */
export function cleanScript(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, ""))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s/.test(line) && !/^title\s*:/i.test(line))
    .map((line) =>
      line
        .replace(/^(narration|script|narrator)\s*:\s*/i, "")
        .replace(/^[-*•]\s+/, "")
        .replace(/\*\*|__|\*|_/g, ""),
    )
    .join(" ")
    .replace(/^["“]|["”]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function scriptSchema(targetWords: number) {
  const min = Math.floor(targetWords * 0.7);
  const max = Math.ceil(targetWords * 1.3);
  return z
    .string()
    .min(1, "The script is empty.")
    .max(LIMITS.maxScriptChars, `The script must be under ${LIMITS.maxScriptChars} characters.`)
    .refine((s) => {
      const n = countWords(s);
      return n >= min && n <= max;
    }, `The script must be between ${min} and ${max} words (target ${targetWords}).`);
}

/** Stage 1: topic → narration text (SERV). Skipped when script.txt exists. */
export async function runScriptStage(ctx: StageContext): Promise<void> {
  const { project, log } = ctx;
  const file = project.path(SCRIPT_FILE);
  if (await fileExists(file)) {
    log.info("script.txt exists, skipping", { words: countWords(await fsp.readFile(file, "utf8")) });
    return;
  }
  const input = project.manifest.input;
  if (input.mode !== "topic") {
    throw new Error(`script stage expected a topic project, got ${input.mode}`);
  }
  checkForcedFailure(ctx, "script", 0);
  const target = targetWordCount(input.minutes);
  log.info("writing script with SERV", { topic: input.topic, targetWords: target });
  const script = await completeValidated(ctx.providers.llm(), scriptMessages(input.topic, target), {
    parse: cleanScript,
    schema: scriptSchema(target),
    log,
    label: "script",
  });
  await writeFileAtomic(file, script + "\n");
  log.info("script written", { words: countWords(script) });
}
