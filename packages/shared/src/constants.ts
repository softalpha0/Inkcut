import type { Aspect } from "./schemas.js";

/** Narration pace used to size scripts and estimate scene length. */
export const WORDS_PER_MINUTE = 150;

/** Target scene length (spec §5.1: 1 scene ≈ 4–8 s of speech). */
export const SCENE_MIN_SEC = 4;
export const SCENE_MAX_SEC = 8;

/** Optional silence between TTS scenes (spec §5.2). */
export const SCENE_GAP_SEC = 0.15;

export const FPS = 30;

export const RESOLUTIONS: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};

/** Image size requested from the image model; multiples of 16, upscaled during render. */
export const IMAGE_SIZES: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1536, height: 864 },
  "9:16": { width: 864, height: 1536 },
};

export interface VoiceOption {
  id: string;
  label: string;
}

/** Edge TTS neural voices offered in v1. */
export const VOICES: readonly VoiceOption[] = [
  { id: "en-US-GuyNeural", label: "Guy (US, male)" },
  { id: "en-US-AriaNeural", label: "Aria (US, female)" },
  { id: "en-US-ChristopherNeural", label: "Christopher (US, male, calm)" },
  { id: "en-US-JennyNeural", label: "Jenny (US, female, warm)" },
  { id: "en-GB-RyanNeural", label: "Ryan (UK, male)" },
  { id: "en-GB-SoniaNeural", label: "Sonia (UK, female)" },
];

export const DEFAULT_VOICE_ID = "en-US-GuyNeural";

export interface StyleOption {
  id: string;
  name: string;
  description: string;
}

/** Style presets offered in the UI; must match packages/pipeline/src/styles (checked by a test). */
export const STYLE_OPTIONS: readonly StyleOption[] = [
  { id: "stickman-classic", name: "Stickman classic", description: "Black ink on white, clean and minimal." },
  { id: "stickman-color", name: "Stickman color", description: "Flat pastel colors and simple scenery." },
];
export const DEFAULT_STYLE_ID = "stickman-classic";
