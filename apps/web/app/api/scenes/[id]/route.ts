import { UpdateSceneSchema } from "@/lib/validation";
import { currentUser, fail, json, readJson } from "@/lib/server/http";
import { getOwnedScene, isActive } from "@/lib/server/projects";
import { adminSupabase } from "@/lib/supabase/admin";

/** PATCH /api/scenes/:id: edit narration or image prompt (then redraw / re-voice / render). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const { id } = await params;
  const found = await getOwnedScene(id, user.id);
  if (!found) return fail(404, "Scene not found");
  if (isActive(found.project)) return fail(409, "Wait until the current job finishes");
  const body = await readJson(req, UpdateSceneSchema);
  if (body instanceof Response) return body;

  const patch: Record<string, string> = {};
  if (body.narration !== undefined) patch.narration = body.narration;
  if (body.imagePrompt !== undefined) patch.image_prompt = body.imagePrompt;
  const { error } = await adminSupabase().from("scenes").update(patch).eq("id", found.scene.id);
  if (error) return fail(500, error.message);
  return json({ ok: true });
}
