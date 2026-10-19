import { currentUser, fail, json } from "@/lib/server/http";
import { getOwnedScene, isActive } from "@/lib/server/projects";
import { startJob } from "@/lib/server/start-job";

/** POST /api/scenes/:id/revoice: re-voice one scene after its narration was edited. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const { id } = await params;
  const found = await getOwnedScene(id, user.id);
  if (!found) return fail(404, "Scene not found");
  if (isActive(found.project)) return fail(409, "Wait until the current job finishes");
  if (found.project.input_mode === "audio") return fail(400, "Voiceover videos use your own recording");
  if (found.project.status === "expired") return fail(410, "This video has expired");
  const blocked = await startJob(found.project.id, user.id, {
    type: "revoice",
    projectId: found.project.id,
    sceneIndex: found.scene.index,
  });
  return blocked ?? json({ ok: true }, 202);
}
