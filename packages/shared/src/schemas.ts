import { z } from "zod";
import { LIMITS } from "./limits.js";

export const MotionSchema = z.enum(["zoom_in", "zoom_out", "pan_left", "pan_right", "static"]);
export type Motion = z.infer<typeof MotionSchema>;

export const AspectSchema = z.enum(["16:9", "9:16"]);
export type Aspect = z.infer<typeof AspectSchema>;

export const InputModeSchema = z.enum(["topic", "script", "audio"]);
export type InputMode = z.infer<typeof InputModeSchema>;

/** One timed word, seconds relative to the scene's own audio. */
export const WordTimingSchema = z.object({
  text: z.string().min(1),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});
export type WordTiming = z.infer<typeof WordTimingSchema>;

/** Spec §5.1. */
export const SceneSchema = z.object({
  index: z.number().int().nonnegative(),
  narration: z.string().trim().min(1),
  visual: z.string().trim().min(1),
  imagePrompt: z.string().trim().min(1),
  motion: MotionSchema,
  durationSec: z.number().positive().optional(),
  audioPath: z.string().optional(),
  imagePath: z.string().optional(),
  /** Audio mode only: where this scene starts in the uploaded voiceover, seconds. */
  startSec: z.number().nonnegative().optional(),
  /** Word timings relative to the scene start. */
  words: z.array(WordTimingSchema).optional(),
  /** What moves in this scene when it is animated (--animate). */
  animationPrompt: z.string().trim().min(1).optional(),
  /** Animated clip for this scene; replaces the zoom/pan of the still image. */
  videoPath: z.string().optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

/** What the LLM returns for one scene in the plan stage. */
export const PlannedSceneSchema = z.object({
  index: z.number().int().nonnegative(),
  visual: z.string().trim().min(1),
  imagePrompt: z.string().trim().min(1),
  motion: MotionSchema,
  animationPrompt: z.string().trim().min(1).optional(),
});
export type PlannedScene = z.infer<typeof PlannedSceneSchema>;

/**
 * LLMs sometimes return the character list as an array of strings or objects
 * instead of one string; accept those and join them rather than spend a retry.
 */
function joinCharacters(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value
    .map((item) =>
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? Object.values(item as Record<string, unknown>)
              .filter((v) => typeof v === "string")
              .join(": ")
          : String(item),
    )
    .filter(Boolean)
    .join(" ");
}

/** Builds the plan-stage schema for an exact number of narration chunks. */
export function makeScenePlanSchema(sceneCount: number) {
  return z
    .object({
      characters: z.preprocess(joinCharacters, z.string().trim().min(1)),
      scenes: z.array(PlannedSceneSchema).length(sceneCount),
    })
    .superRefine((plan, ctx) => {
      plan.scenes.forEach((scene, i) => {
        if (scene.index !== i) {
          ctx.addIssue({
            code: "custom",
            path: ["scenes", i, "index"],
            message: `scenes must be in order: expected index ${i}, got ${scene.index}`,
          });
        }
      });
    });
}
export type ScenePlan = z.infer<ReturnType<typeof makeScenePlanSchema>>;

/** Words of a thumbnail headline; *asterisks* mark the highlighted word. */
export function headlineWords(headline: string): string[] {
  return headline.replace(/\*/g, " ").split(/\s+/).filter(Boolean);
}

/** A thumbnail headline: short, punchy, a few big words (spec §5.5). */
export const ThumbnailHeadlineSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.maxThumbnailHeadlineChars + 4) // room for the *highlight* markers
  .refine((h) => headlineWords(h).length <= LIMITS.maxThumbnailHeadlineWords, {
    message: `Use at most ${LIMITS.maxThumbnailHeadlineWords} words`,
  })
  .refine((h) => h.replace(/\*/g, "").trim().length <= LIMITS.maxThumbnailHeadlineChars, {
    message: `Keep it under ${LIMITS.maxThumbnailHeadlineChars} characters`,
  });

/** What the LLM proposes for each thumbnail. */
export const ThumbnailIdeaSchema = z.object({
  headline: ThumbnailHeadlineSchema,
  imagePrompt: z.string().trim().min(10).max(600),
});

export const ThumbnailPlanSchema = z.object({
  thumbnails: z.array(ThumbnailIdeaSchema).length(LIMITS.thumbnailsPerVideo),
});
export type ThumbnailPlan = z.infer<typeof ThumbnailPlanSchema>;

/** One thumbnail in the manifest. Paths are relative to the project folder. */
export const ThumbnailSchema = ThumbnailIdeaSchema.extend({
  index: z.number().int().nonnegative(),
  seed: z.number().int().nonnegative(),
  /** The drawn picture (no text). */
  imagePath: z.string().optional(),
  /** 1280x720 JPEG with the headline. */
  outputPath: z.string().optional(),
  /** 1280x720 JPEG without text. */
  cleanPath: z.string().optional(),
});
export type Thumbnail = z.infer<typeof ThumbnailSchema>;

/** Spec §5.3. */
export const StylePresetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  promptPrefix: z.string().min(1),
  negativePrompt: z.string(),
  seed: z.number().int().nonnegative().optional(),
  characterSheet: z.string().optional(),
  /** Example recurring character for the storyboard prompt, e.g. "Sam: a stick figure with a red scarf". */
  exampleCharacter: z.string().optional(),
});
export type StylePreset = z.infer<typeof StylePresetSchema>;

export const StageNameSchema = z.enum([
  "script",
  "transcribe",
  "plan",
  "voice",
  "draw",
  "animate",
  "render",
  "thumbnail",
]);
export type StageName = z.infer<typeof StageNameSchema>;

export const ProjectInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("topic"), topic: z.string().trim().min(1), minutes: z.number().int() }),
  z.object({ mode: z.literal("script"), scriptFile: z.string().min(1) }),
  z.object({ mode: z.literal("audio"), audioFile: z.string().min(1) }),
]);
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export const ApiCallCountsSchema = z.record(z.string(), z.number().int().nonnegative());
export type ApiCallCounts = z.infer<typeof ApiCallCountsSchema>;

/** Saved as out/<id>/project.json; the single source of truth for resume. */
export const ProjectManifestSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  input: ProjectInputSchema,
  styleId: z.string(),
  /** The user's own description of the look when styleId is "custom". */
  customStyle: z.string().optional(),
  aspect: AspectSchema,
  voiceId: z.string(),
  captions: z.boolean(),
  seed: z.number().int().nonnegative(),
  characters: z.string().optional(),
  /** Image-to-video animation settings (--animate); absent means still images with zoom/pan. */
  animate: z
    .object({
      enabled: z.boolean(),
      /** Animate at most this many scenes; the rest keep zoom/pan. */
      maxScenes: z.number().int().positive().optional(),
    })
    .optional(),
  completedStages: z.array(StageNameSchema),
  scenes: z.array(SceneSchema),
  /** YouTube thumbnails (thumbnail stage). */
  thumbnails: z.array(ThumbnailSchema).optional(),
  outputPath: z.string().optional(),
  runs: z.array(
    z.object({
      startedAt: z.string(),
      finishedAt: z.string().optional(),
      status: z.enum(["running", "done", "failed"]),
      error: z.string().optional(),
      apiCalls: ApiCallCountsSchema,
    }),
  ),
});
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;
