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
  { id: "flat-cartoon", name: "Flat cartoon", description: "Bright, modern explainer characters." },
  { id: "whiteboard", name: "Whiteboard doodle", description: "Marker drawings on a whiteboard." },
  { id: "storybook", name: "Storybook", description: "Soft watercolor, great for stories and kids." },
  { id: "comic", name: "Comic book", description: "Bold ink, strong colors and halftone dots." },
  { id: "chalkboard", name: "Chalkboard", description: "White and colored chalk on a dark board." },
  { id: "paper-cutout", name: "Paper cut-out", description: "Layered craft paper with soft shadows." },
];

/** Style id for a look the user describes in their own words. */
export const CUSTOM_STYLE_ID = "custom";

/**
 * Studio, show and character names a custom style may not use. Inkcut describes a
 * look ("flat sitcom cartoon") instead of copying a protected brand.
 */
const PROTECTED_STYLE_NAMES = [
  "disney",
  "pixar",
  "dreamworks",
  "ghibli",
  "miyazaki",
  "simpsons",
  "family guy",
  "south park",
  "rick and morty",
  "futurama",
  "spongebob",
  "nickelodeon",
  "cartoon network",
  "looney tunes",
  "warner bros",
  "marvel",
  "dc comics",
  "batman",
  "superman",
  "spider-man",
  "spiderman",
  "avengers",
  "star wars",
  "mickey",
  "minnie",
  "pokemon",
  "pokémon",
  "nintendo",
  "mario",
  "zelda",
  "sanrio",
  "hello kitty",
  "peanuts",
  "snoopy",
  "garfield",
  "minecraft",
  "lego",
  "roblox",
  "fortnite",
  "naruto",
  "one piece",
  "dragon ball",
  "studio trigger",
  "kurzgesagt",
  "bluey",
  "peppa pig",
  "paw patrol",
  "adventure time",
  "gravity falls",
  "toei",
  "illumination",
  "minions",
];

/** Why a custom style description is not accepted, or undefined when it is fine. */
export function customStyleProblem(text: string, maxChars: number): string | undefined {
  const t = text.trim();
  if (t.length < 3) return "Describe the art style in a few words";
  if (t.length > maxChars) return `Keep the style description under ${maxChars} characters`;
  const lower = t.toLowerCase();
  const brand = PROTECTED_STYLE_NAMES.find((name) =>
    new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}s?($|[^a-z])`).test(lower),
  );
  if (brand) {
    return `Please describe the look instead of naming "${brand}" (for example "bright 3D family cartoon")`;
  }
  return undefined;
}

export const DEFAULT_STYLE_ID = "stickman-classic";
