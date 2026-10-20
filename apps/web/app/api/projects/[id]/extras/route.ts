import { currentUser, fail, json } from "@/lib/server/http";
import { getOwnedProject, isActive, listScenes } from "@/lib/server/projects";
import { startJob } from "@/lib/server/start-job";

/**
 * POST /api/projects/:id/extras: make whatever is missing of the thumbnails and the
 * YouTube details (titles, description, tags) for a finished video. Free; the video
 * itself is not re-rendered.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const { id } = await params;
  const project = await getOwnedProject(id, user.id);
  if (!project) return fail(404, "Video not found");
  if (isActive(project)) return fail(409, "Wait until the current job finishes");
  if (project.status === "expired") return fail(410, "This video has expired");
  const scenes = await listScenes(project.id);
  if (scenes.length === 0 || scenes.some((s) => !s.image_path)) return fail(409, "Generate the scenes first");
  const blocked = await startJob(project.id, user.id, { type: "extras", projectId: project.id });
  return blocked ?? json({ ok: true }, 202);
}
