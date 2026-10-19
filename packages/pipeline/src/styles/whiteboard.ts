import type { StylePreset } from "@inkcut/shared";

export const whiteboard: StylePreset = {
  id: "whiteboard",
  name: "Whiteboard doodle",
  promptPrefix:
    "hand-drawn whiteboard doodle, black dry-erase marker lines on a clean white whiteboard, a few accents in red and blue marker, simple sketchy cartoon figures and objects, flat 2D, whiteboard animation frame",
  negativePrompt:
    "text, letters, words, numbers, watermark, signature, speech bubble, photorealistic, 3d render, hand, marker pen, shading, clutter",
  characterSheet:
    "Figures are simple sketchy cartoon people drawn in black marker with round heads and dot eyes.",
  exampleCharacter: "Leo: a sketchy cartoon man with spiky hair and a blue tie",
};
