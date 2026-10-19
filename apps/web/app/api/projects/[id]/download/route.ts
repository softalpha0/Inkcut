import { NextResponse } from "next/server";
import { currentUser, fail } from "@/lib/server/http";
import { getOwnedProject, signOutputUrl } from "@/lib/server/projects";

/** GET /api/projects/:id/download: redirect to a short-lived signed URL for the MP4. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const { id } = await params;
  const project = await getOwnedProject(id, user.id);
  if (!project) return fail(404, "Video not found");
  if (project.status === "expired" || !project.output_path)
    return fail(410, "This video is no longer available");
  const safeName =
    project.title
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .slice(0, 60) || "inkcut-video";
  const url = await signOutputUrl(project.output_path, `${safeName}.mp4`);
  if (!url) return fail(404, "The video file was not found");
  return NextResponse.redirect(url, 302);
}
