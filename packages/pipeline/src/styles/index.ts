import { StylePresetSchema, type StylePreset } from "@inkcut/shared";
import { stickmanClassic } from "./stickman-classic.js";
import { stickmanColor } from "./stickman-color.js";

export const STYLES: Readonly<Record<string, StylePreset>> = Object.fromEntries(
  [stickmanClassic, stickmanColor].map((s) => [s.id, StylePresetSchema.parse(s)]),
);

export function getStyle(id: string): StylePreset {
  const style = STYLES[id];
  if (!style) throw new Error(`Unknown style "${id}". Available: ${Object.keys(STYLES).join(", ")}`);
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
