import { currentUser, fail, json } from "@/lib/server/http";
import { getOwnedProject } from "@/lib/server/projects";
import { startJob } from "@/lib/server/start-job";

/** POST /api/projects/:id/retry: resume a failed video from the stage that failed (no extra usage). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const { id } = await params;
  const project = await getOwnedProject(id, user.id);
  if (!project) return fail(404, "Video not found");
  if (project.status !== "failed") return fail(409, "Only failed videos can be retried");
  const blocked = await startJob(project.id, user.id, { type: "generate", projectId: project.id });
  return blocked ?? json({ ok: true }, 202);
}
