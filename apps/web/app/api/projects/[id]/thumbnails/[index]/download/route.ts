import { NextResponse } from "next/server";
import { currentUser, fail } from "@/lib/server/http";
import { getOwnedProject, readThumbnails, signAssetUrl, thumbnailStoragePath } from "@/lib/server/projects";

/** GET /api/projects/:id/thumbnails/:index/download[?clean=1]: the JPEG as a file download. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const { id, index } = await params;
  const project = await getOwnedProject(id, user.id);
  if (!project) return fail(404, "Video not found");
  if (project.status === "expired") return fail(410, "This video is no longer available");

  const thumb = (await readThumbnails(project)).find((t) => t.index === Number(index));
  const clean = new URL(req.url).searchParams.get("clean") === "1";
  const rel = clean ? thumb?.cleanPath : thumb?.outputPath;
  if (!thumb || !rel) return fail(404, "Thumbnail not found");
  const name = `inkcut-thumbnail-${thumb.index + 1}${clean ? "-no-text" : ""}.jpg`;
  const url = await signAssetUrl(thumbnailStoragePath(project, rel), name);
  if (!url) return fail(404, "The thumbnail file was not found");
  return NextResponse.redirect(url, 302);
}
