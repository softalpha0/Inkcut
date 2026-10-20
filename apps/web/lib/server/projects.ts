import "server-only";
import { BUCKETS, assetsPrefix, type ProjectRow, type SceneRow } from "@inkcut/db";
import {
  ACTIVE_STATUSES,
  ThumbnailSchema,
  YoutubeKitSchema,
  type Thumbnail,
  type YoutubeKit,
} from "@inkcut/shared";
import { z } from "zod";
import { utcDay, type UsageToday } from "../validation";
import { adminSupabase } from "../supabase/admin";

const SIGNED_URL_SECONDS = 60 * 60;

export async function getOwnedProject(id: string, userId: string): Promise<ProjectRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await adminSupabase()
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ProjectRow | null;
}

export async function getOwnedScene(
  sceneId: string,
  userId: string,
): Promise<{ scene: SceneRow; project: ProjectRow } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(sceneId)) return null;
  const { data, error } = await adminSupabase().from("scenes").select("*").eq("id", sceneId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const project = await getOwnedProject((data as SceneRow).project_id, userId);
  return project ? { scene: data as SceneRow, project } : null;
}

export function isActive(project: Pick<ProjectRow, "status">): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(project.status);
}

/** Spec §8: one running job per user. */
export async function hasActiveJob(userId: string): Promise<boolean> {
  const { count, error } = await adminSupabase()
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", [...ACTIVE_STATUSES]);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/** Atomically counts one use; false when today's limit is reached. */
export async function bumpUsage(userId: string, kind: "videos_started" | "redraws", limit: number) {
  const { data, error } = await adminSupabase().rpc("bump_usage", {
    p_user: userId,
    p_kind: kind,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data as number) >= 0;
}

export async function usageToday(userId: string): Promise<UsageToday> {
  const { data } = await adminSupabase()
    .from("usage_daily")
    .select("videos_started, redraws")
    .eq("user_id", userId)
    .eq("day", utcDay())
    .maybeSingle();
  return { videosStarted: data?.videos_started ?? 0, redraws: data?.redraws ?? 0 };
}

export async function setStatus(id: string, patch: Partial<ProjectRow>) {
  const { error } = await adminSupabase().from("projects").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Signed URLs for scene media, keyed by storage path. */
export async function signAssetUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await adminSupabase()
    .storage.from(BUCKETS.assets)
    .createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}

export async function signOutputUrl(path: string, download?: string): Promise<string | null> {
  const { data } = await adminSupabase()
    .storage.from(BUCKETS.outputs)
    .createSignedUrl(path, SIGNED_URL_SECONDS, download ? { download } : undefined);
  return data?.signedUrl ?? null;
}

export async function listScenes(projectId: string): Promise<SceneRow[]> {
  const { data, error } = await adminSupabase()
    .from("scenes")
    .select("*")
    .eq("project_id", projectId)
    .order("index");
  if (error) throw new Error(error.message);
  return (data ?? []) as SceneRow[];
}

export async function signAssetUrl(path: string, download?: string): Promise<string | null> {
  const { data } = await adminSupabase()
    .storage.from(BUCKETS.assets)
    .createSignedUrl(path, SIGNED_URL_SECONDS, download ? { download } : undefined);
  return data?.signedUrl ?? null;
}

const ManifestExtrasSchema = z.object({
  thumbnails: z.array(ThumbnailSchema).optional(),
  youtube: z.unknown().optional(),
});

/**
 * The project's thumbnails and YouTube details, read from its saved project.json
 * (the worker keeps it in storage). Missing or unreadable parts come back empty.
 */
export async function readExtras(
  project: Pick<ProjectRow, "id" | "user_id">,
): Promise<{ thumbnails: Thumbnail[]; youtube: YoutubeKit | null }> {
  const empty = { thumbnails: [], youtube: null };
  const { data, error } = await adminSupabase()
    .storage.from(BUCKETS.assets)
    .download(`${assetsPrefix(project.user_id, project.id)}/project.json`);
  if (error || !data) return empty;
  try {
    const parsed = ManifestExtrasSchema.safeParse(JSON.parse(await data.text()));
    if (!parsed.success) return empty;
    const youtube = YoutubeKitSchema.safeParse(parsed.data.youtube);
    return { thumbnails: parsed.data.thumbnails ?? [], youtube: youtube.success ? youtube.data : null };
  } catch {
    return empty;
  }
}

export async function readThumbnails(project: Pick<ProjectRow, "id" | "user_id">): Promise<Thumbnail[]> {
  return (await readExtras(project)).thumbnails;
}

/** Storage path of one thumbnail file (relative manifest path → bucket path). */
export function thumbnailStoragePath(project: Pick<ProjectRow, "id" | "user_id">, rel: string): string {
  return `${assetsPrefix(project.user_id, project.id)}/${rel}`;
}
