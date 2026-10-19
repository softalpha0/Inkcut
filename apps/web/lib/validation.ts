import { AspectSchema, LIMITS, STYLE_OPTIONS, VOICES } from "@inkcut/shared";
import { z } from "zod";

const styleId = z.enum(STYLE_OPTIONS.map((s) => s.id) as [string, ...string[]]);
const voiceId = z.enum(VOICES.map((v) => v.id) as [string, ...string[]]);

const common = {
  title: z.string().trim().max(120).optional(),
  styleId,
  aspect: AspectSchema,
  voiceId,
  captions: z.boolean(),
  animate: z.boolean().default(false),
};

export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a"] as const;

/** POST /api/projects body (spec §8 limits applied here). */
export const CreateProjectSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("topic"),
    topic: z.string().trim().min(3, "Describe the topic in a few words").max(300),
    minutes: z.number().int().min(LIMITS.minVideoMinutes).max(LIMITS.maxVideoMinutes),
    ...common,
  }),
  z.object({
    mode: z.literal("script"),
    script: z
      .string()
      .trim()
      .min(20, "The script is too short")
      .max(
        LIMITS.maxScriptChars,
        `Scripts can be up to ${LIMITS.maxScriptChars.toLocaleString("en")} characters`,
      ),
    ...common,
  }),
  z.object({
    mode: z.literal("audio"),
    audioPath: z.string().min(1).max(300),
    ...common,
  }),
]);
export type CreateProject = z.infer<typeof CreateProjectSchema>;

/** PATCH /api/scenes/:id body. */
export const UpdateSceneSchema = z
  .object({
    narration: z.string().trim().min(1).max(600).optional(),
    imagePrompt: z.string().trim().min(3).max(800).optional(),
  })
  .refine((v) => v.narration !== undefined || v.imagePrompt !== undefined, "Nothing to update");

/** POST /api/uploads/voiceover body. */
export const UploadRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  size: z
    .number()
    .int()
    .positive()
    .max(LIMITS.maxUploadAudioBytes, `Voiceovers can be up to ${LIMITS.maxUploadAudioBytes / 1048576} MB`),
});

export function audioExtension(fileName: string): string | undefined {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext) ? ext : undefined;
}

/** A short title for the dashboard. */
export function titleFor(input: CreateProject): string {
  if (input.title) return input.title;
  if (input.mode === "topic") return input.topic.slice(0, 80);
  if (input.mode === "script") {
    const words = input.script.split(/\s+/).slice(0, 8).join(" ");
    return words.length < input.script.length ? `${words}…` : words;
  }
  return "Voiceover video";
}

/** ADMIN_EMAILS="a@x.com,b@y.com": only these accounts may use paid animation. */
export function isAdmin(email: string | undefined | null, adminEmails: string | undefined): boolean {
  if (!email || !adminEmails) return false;
  return adminEmails
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export interface UsageToday {
  videosStarted: number;
  redraws: number;
}

export function usageSummary(usage: UsageToday | null) {
  const videos = usage?.videosStarted ?? 0;
  const redraws = usage?.redraws ?? 0;
  return {
    videosLeft: Math.max(0, LIMITS.videosPerUserPerDay - videos),
    videosPerDay: LIMITS.videosPerUserPerDay,
    redrawsLeft: Math.max(0, LIMITS.redrawsPerUserPerDay - redraws),
    redrawsPerDay: LIMITS.redrawsPerUserPerDay,
  };
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
