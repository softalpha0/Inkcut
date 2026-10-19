/**
 * All usage and safety limits live here so they can change in one place (spec §8).
 */
export const LIMITS = {
  /** Videos a user may start per day. */
  videosPerUserPerDay: 3,
  /** Shortest topic-mode video, minutes. */
  minVideoMinutes: 1,
  /** Longest video of any mode, minutes. */
  maxVideoMinutes: 5,
  /** Longest pasted script, characters. */
  maxScriptChars: 6000,
  /** Single-scene redraws a user may run per day. */
  redrawsPerUserPerDay: 30,
  /** Longest uploaded voiceover, seconds. */
  maxUploadAudioSec: 5 * 60,
  /** Largest uploaded voiceover, bytes. */
  maxUploadAudioBytes: 25 * 1024 * 1024,
  /** Hours a rendered MP4 is kept before cleanup. */
  outputRetentionHours: 48,
  /** Pipeline jobs one user may run at once. */
  concurrentJobsPerUser: 1,
  /** Most scenes one video may animate with image-to-video (paid per second). */
  maxAnimatedScenesPerVideo: 70,
  /** Longest wait for one image-to-video job, ms. */
  animateJobTimeoutMs: 10 * 60 * 1000,
  /** Retries after an LLM reply fails schema validation. */
  llmValidationRetries: 2,
  /** Retries after a failed network call (timeouts, 5xx, 429). */
  networkRetries: 3,
} as const;

export type Limits = typeof LIMITS;
