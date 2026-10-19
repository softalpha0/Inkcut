import { z } from "zod";

/** BullMQ queue shared by the web app (producer) and the worker (consumer). */
export const QUEUE_NAME = "inkcut";

export const JobDataSchema = z.discriminatedUnion("type", [
  /** Run the whole pipeline (or resume it) and render the MP4. */
  z.object({ type: z.literal("generate"), projectId: z.string().uuid() }),
  /** Redraw one scene's image (and its animation, if the project animates). */
  z.object({
    type: z.literal("redraw"),
    projectId: z.string().uuid(),
    sceneIndex: z.number().int().nonnegative(),
  }),
  /** Re-voice one scene after its narration was edited. */
  z.object({
    type: z.literal("revoice"),
    projectId: z.string().uuid(),
    sceneIndex: z.number().int().nonnegative(),
  }),
  /** Render the MP4 from the current scenes. */
  z.object({ type: z.literal("render"), projectId: z.string().uuid() }),
  /** Delete outputs and assets past their retention time. */
  z.object({ type: z.literal("cleanup") }),
]);
export type JobData = z.infer<typeof JobDataSchema>;

/** Project status values stored in projects.status (spec §6, plus transcribing/animating/expired). */
export const ProjectStatusSchema = z.enum([
  "draft",
  "queued",
  "scripting",
  "transcribing",
  "planning",
  "voicing",
  "drawing",
  "animating",
  "rendering",
  "done",
  "failed",
  "expired",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/** Statuses that mean a job is queued or running for the project. */
export const ACTIVE_STATUSES: readonly ProjectStatus[] = [
  "queued",
  "scripting",
  "transcribing",
  "planning",
  "voicing",
  "drawing",
  "animating",
  "rendering",
];

export const STAGE_STATUS = {
  script: "scripting",
  transcribe: "transcribing",
  plan: "planning",
  voice: "voicing",
  draw: "drawing",
  animate: "animating",
  render: "rendering",
} as const satisfies Record<string, ProjectStatus>;

/** BullMQ job id: one job per project at a time (duplicates are ignored by BullMQ). */
export function jobIdFor(data: JobData): string {
  return data.type === "cleanup" ? "cleanup" : `${data.type}:${data.projectId}:${Date.now()}`;
}
