import {
  CUSTOM_STYLE_ID,
  LIMITS,
  StylePresetSchema,
  customStyleProblem,
  type StylePreset,
} from "@inkcut/shared";
import { chalkboard } from "./chalkboard.js";
import { comic } from "./comic.js";
import { flatCartoon } from "./flat-cartoon.js";
import { paperCutout } from "./paper-cutout.js";
import { stickmanClassic } from "./stickman-classic.js";
import { stickmanColor } from "./stickman-color.js";
import { storybook } from "./storybook.js";
import { whiteboard } from "./whiteboard.js";

export const STYLES: Readonly<Record<string, StylePreset>> = Object.fromEntries(
  [stickmanClassic, stickmanColor, flatCartoon, whiteboard, storybook, comic, chalkboard, paperCutout].map(
    (s) => [s.id, StylePresetSchema.parse(s)],
  ),
);

/** A preset built from the user's own description of the look ("1950s retro cartoon, muted colours"). */
export function customStyle(description: string): StylePreset {
  const problem = customStyleProblem(description, LIMITS.maxCustomStyleChars);
  if (problem) throw new Error(`Custom style not accepted: ${problem}`);
  const look = description.trim().replace(/[.\s]+$/, "");
  return StylePresetSchema.parse({
    id: CUSTOM_STYLE_ID,
    name: "Custom style",
    promptPrefix: `${look}, illustration for an explainer video, clear simple composition, consistent character design`,
    negativePrompt: "text, letters, words, numbers, watermark, signature, speech bubble, clutter",
    characterSheet:
      "Recurring characters keep exactly the same face, hair, outfit and colours in every scene.",
    exampleCharacter: "Sam: a young man with curly red hair and a green jacket",
  });
}

/** The preset for a style id; "custom" needs the user's description. */
export function getStyle(id: string, custom?: string): StylePreset {
  if (id === CUSTOM_STYLE_ID) {
    if (!custom) throw new Error('The "custom" style needs a description of the look');
    return customStyle(custom);
  }
  const style = STYLES[id];
  if (!style) {
    throw new Error(
      `Unknown style "${id}". Available: ${[...Object.keys(STYLES), CUSTOM_STYLE_ID].join(", ")}`,
    );
  }
  return style;
}

/**
 * Final prompt sent to the image model. Flux Schnell has no negative prompt, so the
 * "no text" rule is also stated positively in the prompt itself.
 */
export function buildImagePrompt(style: StylePreset, imagePrompt: string, characters?: string): string {
  return [
    style.promptPrefix + ".",
    style.characterSheet,
    characters ? `Characters: ${characters}` : undefined,
    `Scene: ${imagePrompt.trim().replace(/\.?$/, ".")}`,
    "No text, letters or words anywhere in the image.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Stable per-project seed so every scene shares the same look (spec §5.3). */
export function projectSeed(style: StylePreset, projectId: string): number {
  if (style.seed !== undefined) return style.seed;
  let h = 2166136261;
  for (const ch of projectId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 2_147_483_647;
}
