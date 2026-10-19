import { currentUser, fail, json } from "@/lib/server/http";
import {
  getOwnedProject,
  isActive,
  listScenes,
  readThumbnails,
  signAssetUrls,
  signOutputUrl,
  thumbnailStoragePath,
} from "@/lib/server/projects";

/** GET /api/projects/:id: project, scenes and short-lived media URLs. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  const { id } = await params;
  const project = await getOwnedProject(id, user.id);
  if (!project) return fail(404, "Video not found");

  const scenes = await listScenes(project.id);
  const urls = await signAssetUrls(
    scenes.flatMap((s) => [s.image_path ?? "", s.audio_path ?? "", s.video_path ?? ""]),
  );
  const videoUrl =
    project.output_path && project.status !== "expired" ? await signOutputUrl(project.output_path) : null;
  // Thumbnails live in the saved project.json; skip the read while a job is still running.
  const thumbs = isActive(project) || project.status === "expired" ? [] : await readThumbnails(project);
  const ready = thumbs.filter((t) => t.outputPath && t.cleanPath);
  const thumbUrls = await signAssetUrls(
    ready.flatMap((t) => [
      thumbnailStoragePath(project, t.outputPath!),
      thumbnailStoragePath(project, t.cleanPath!),
    ]),
  );
  return json({
    project,
    videoUrl,
    thumbnails: ready.map((t) => ({
      index: t.index,
      headline: t.headline,
      url: thumbUrls[thumbnailStoragePath(project, t.outputPath!)] ?? null,
      cleanUrl: thumbUrls[thumbnailStoragePath(project, t.cleanPath!)] ?? null,
    })),
    scenes: scenes.map((s) => ({
      id: s.id,
      index: s.index,
      narration: s.narration,
      visual: s.visual,
      imagePrompt: s.image_prompt,
      motion: s.motion,
      durationSec: s.duration_sec === null ? null : Number(s.duration_sec),
      imageUrl: s.image_path ? (urls[s.image_path] ?? null) : null,
      audioUrl: s.audio_path ? (urls[s.audio_path] ?? null) : null,
      videoUrl: s.video_path ? (urls[s.video_path] ?? null) : null,
    })),
  });
}
