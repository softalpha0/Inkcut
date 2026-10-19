import { LIMITS } from "@inkcut/shared";
import { currentUser, fail, json } from "@/lib/server/http";
import { bumpUsage, getOwnedProject, hasActiveJob, isActive } from "@/lib/server/projects";
import { startJob } from "@/lib/server/start-job";

/** POST /api/projects/:id/generate: start making the video (counts toward the daily limit). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const { id } = await params;
  const project = await getOwnedProject(id, user.id);
  if (!project) return fail(404, "Video not found");
  if (isActive(project)) return fail(409, "This video is already being made");
  if (project.status !== "draft") return fail(409, "This video was already generated; use retry or render");

  // Check the one-job rule before counting usage, so a blocked request costs nothing.
  if (await hasActiveJob(user.id))
    return fail(409, "You already have a video in progress. Wait for it to finish first.");
  if (!(await bumpUsage(user.id, "videos_started", LIMITS.videosPerUserPerDay))) {
    return fail(
      429,
      `You've used your ${LIMITS.videosPerUserPerDay} free videos for today. Come back tomorrow!`,
    );
  }
  const blocked = await startJob(project.id, user.id, { type: "generate", projectId: project.id });
  return blocked ?? json({ ok: true }, 202);
}
