import { LIMITS } from "@inkcut/shared";
import { currentUser, fail, json, readJson } from "@/lib/server/http";
import { bumpUsage, getOwnedProject, isActive, readThumbnails } from "@/lib/server/projects";
import { startJob } from "@/lib/server/start-job";
import { UpdateThumbnailSchema } from "@/lib/validation";

/**
 * POST /api/projects/:id/thumbnails/:index: change a thumbnail's headline (free,
 * text only) and/or draw a new picture for it (counts as one redraw).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const { id, index: indexText } = await params;
  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 0 || index >= LIMITS.thumbnailsPerVideo)
    return fail(404, "Thumbnail not found");
  const project = await getOwnedProject(id, user.id);
  if (!project) return fail(404, "Video not found");
  const input = await readJson(req, UpdateThumbnailSchema);
  if (input instanceof Response) return input;

  if (isActive(project)) return fail(409, "Wait until the current job finishes");
  if (project.status === "expired") return fail(410, "This video has expired");
  if (!(await readThumbnails(project)).some((t) => t.index === index))
    return fail(409, "This video has no thumbnails yet");
  if (input.redraw && !(await bumpUsage(user.id, "redraws", LIMITS.redrawsPerUserPerDay))) {
    return fail(429, `You've used your ${LIMITS.redrawsPerUserPerDay} redraws for today`);
  }
  const blocked = await startJob(project.id, user.id, {
    type: "thumbnail",
    projectId: project.id,
    index,
    redraw: input.redraw,
    ...(input.headline ? { headline: input.headline } : {}),
  });
  return blocked ?? json({ ok: true }, 202);
}
