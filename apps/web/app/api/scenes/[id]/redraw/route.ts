import { LIMITS } from "@inkcut/shared";
import { currentUser, fail, json } from "@/lib/server/http";
import { bumpUsage, getOwnedScene, hasActiveJob, isActive } from "@/lib/server/projects";
import { startJob } from "@/lib/server/start-job";

/** POST /api/scenes/:id/redraw: redraw one scene (30 per day). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const { id } = await params;
  const found = await getOwnedScene(id, user.id);
  if (!found) return fail(404, "Scene not found");
  if (isActive(found.project)) return fail(409, "Wait until the current job finishes");
  if (found.project.status === "expired") return fail(410, "This video has expired");
  if (await hasActiveJob(user.id))
    return fail(409, "You already have a video in progress. Wait for it to finish first.");
  if (!(await bumpUsage(user.id, "redraws", LIMITS.redrawsPerUserPerDay))) {
    return fail(429, `You've used your ${LIMITS.redrawsPerUserPerDay} redraws for today`);
  }
  const blocked = await startJob(found.project.id, user.id, {
    type: "redraw",
    projectId: found.project.id,
    sceneIndex: found.scene.index,
  });
  return blocked ?? json({ ok: true }, 202);
}
