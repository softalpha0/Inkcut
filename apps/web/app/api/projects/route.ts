import { LIMITS } from "@inkcut/shared";
import type { ProjectRow } from "@inkcut/db";
import { CreateProjectSchema, isAdmin, titleFor, usageSummary } from "@/lib/validation";
import { currentUser, fail, json, readJson } from "@/lib/server/http";
import { serverEnv } from "@/lib/server/env";
import { usageToday } from "@/lib/server/projects";
import { adminSupabase } from "@/lib/supabase/admin";

/** GET /api/projects: my projects and today's remaining usage. */
export async function GET() {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const { data, error } = await adminSupabase()
    .from("projects")
    .select("id, title, input_mode, status, current_stage, aspect, output_expires_at, created_at, error")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return fail(500, error.message);
  return json({ projects: data, usage: usageSummary(await usageToday(user.id)) });
}

/** POST /api/projects: create a draft project (validates limits; generation starts separately). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const input = await readJson(req, CreateProjectSchema);
  if (input instanceof Response) return input;

  if (input.animate && !isAdmin(user.email, serverEnv.adminEmails())) {
    return fail(403, "Animation is not available on the free plan yet");
  }
  if (input.mode === "audio" && !input.audioPath.startsWith(`${user.id}/`)) {
    return fail(400, "Upload the voiceover first");
  }

  const row: Partial<ProjectRow> = {
    user_id: user.id,
    title: titleFor(input),
    input_mode: input.mode,
    topic: input.mode === "topic" ? input.topic : null,
    minutes: input.mode === "topic" ? input.minutes : null,
    script: input.mode === "script" ? input.script.slice(0, LIMITS.maxScriptChars) : null,
    audio_path: input.mode === "audio" ? input.audioPath : null,
    style_id: input.styleId,
    aspect: input.aspect,
    voice_id: input.voiceId,
    captions: input.captions,
    animate: input.animate,
    status: "draft",
  };
  const { data, error } = await adminSupabase().from("projects").insert(row).select("id").single();
  if (error) return fail(500, error.message);
  return json({ id: (data as { id: string }).id }, 201);
}
