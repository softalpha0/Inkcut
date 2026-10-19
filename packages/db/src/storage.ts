/** Storage buckets (all private; reads via signed URLs). */
export const BUCKETS = {
  uploads: "uploads",
  assets: "assets",
  outputs: "outputs",
} as const;

/** Prefix for a project's pipeline files in the assets bucket. */
export function assetsPrefix(userId: string, projectId: string): string {
  return `${userId}/${projectId}`;
}

export function outputPath(userId: string, projectId: string): string {
  return `${userId}/${projectId}/final.mp4`;
}

/** Folders inside a project's assets prefix (storage lists are not recursive). */
export const ASSET_FOLDERS = ["", "input", "audio", "images", "animated", "thumbnails"] as const;
