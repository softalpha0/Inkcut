import type { ProjectRow, SceneRow } from "@inkcut/db";
import type { ProjectStatus } from "@inkcut/shared";

export type ProjectPatch = Partial<
  Pick<ProjectRow, "status" | "current_stage" | "error" | "output_path" | "output_expires_at">
>;

export type SceneInput = Omit<SceneRow, "id" | "project_id" | "updated_at">;

/** Database access the worker needs (service role). */
export interface ProjectStore {
  getProject(id: string): Promise<ProjectRow | null>;
  updateProject(id: string, patch: ProjectPatch): Promise<void>;
  listScenes(projectId: string): Promise<SceneRow[]>;
  /** Upsert scenes by (project_id, index) and delete any with a higher index. */
  replaceScenes(projectId: string, scenes: SceneInput[]): Promise<void>;
  /** Projects whose output expired before `nowIso` and are not yet cleaned up. */
  listExpired(nowIso: string, limit: number): Promise<Pick<ProjectRow, "id" | "user_id" | "audio_path">[]>;
  /** Projects in one of `statuses` whose row was last updated before `beforeIso`. */
  listStuck(
    statuses: readonly ProjectStatus[],
    beforeIso: string,
    limit: number,
  ): Promise<Pick<ProjectRow, "id">[]>;
}

/** File storage access the worker needs (service role). */
export interface AssetStore {
  /** File names directly under `prefix` (not recursive). */
  list(bucket: string, prefix: string): Promise<string[]>;
  /** Downloads to `localFile`; false when the object does not exist. */
  download(bucket: string, objectPath: string, localFile: string): Promise<boolean>;
  upload(bucket: string, objectPath: string, localFile: string, contentType: string): Promise<void>;
  remove(bucket: string, objectPaths: string[]): Promise<void>;
}
