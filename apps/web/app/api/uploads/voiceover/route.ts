import { BUCKETS } from "@inkcut/db";
import { UploadRequestSchema, audioExtension } from "@/lib/validation";
import { currentUser, fail, json, readJson } from "@/lib/server/http";
import { adminSupabase } from "@/lib/supabase/admin";

/** POST /api/uploads/voiceover: signed upload URL for an mp3/wav/m4a (max 25 MB; 5 min checked by the worker). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const body = await readJson(req, UploadRequestSchema);
  if (body instanceof Response) return body;
  const ext = audioExtension(body.fileName);
  if (!ext) return fail(400, "Upload an .mp3, .wav or .m4a file");

  const path = `${user.id}/${crypto.randomUUID()}${ext}`;
  const { data, error } = await adminSupabase().storage.from(BUCKETS.uploads).createSignedUploadUrl(path);
  if (error || !data) return fail(500, error?.message ?? "Could not prepare the upload");
  return json({ path: data.path, token: data.token });
}
