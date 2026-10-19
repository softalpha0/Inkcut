import type { Aspect, InputMode, Motion, ProjectStatus } from "@inkcut/shared";

/** Row in public.projects (spec §6). */
export interface ProjectRow {
  id: string;
  user_id: string;
  title: string;
  input_mode: InputMode;
  topic: string | null;
  script: string | null;
  minutes: number | null;
  audio_path: string | null;
  style_id: string;
  /** The user's own style description when style_id is "custom" (migration 0002). */
  custom_style?: string | null;
  aspect: Aspect;
  voice_id: string;
  captions: boolean;
  animate: boolean;
  status: ProjectStatus;
  current_stage: string | null;
  error: string | null;
  output_path: string | null;
  output_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Row in public.scenes. */
export interface SceneRow {
  id: string;
  project_id: string;
  index: number;
  narration: string;
  visual: string;
  image_prompt: string;
  motion: Motion;
  duration_sec: number | null;
  audio_path: string | null;
  image_path: string | null;
  video_path: string | null;
  updated_at: string;
}

export interface UsageRow {
  user_id: string;
  day: string;
  videos_started: number;
  redraws: number;
}
