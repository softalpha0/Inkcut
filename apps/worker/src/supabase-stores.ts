import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ProjectRow, SceneRow, SupabaseClient } from "@inkcut/db";
import type { ProjectStatus } from "@inkcut/shared";
import type { AssetStore, ProjectPatch, ProjectStore, SceneInput } from "./stores.js";

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export class SupabaseProjectStore implements ProjectStore {
  constructor(private readonly db: SupabaseClient) {}

  async getProject(id: string): Promise<ProjectRow | null> {
    const res = await this.db.from("projects").select("*").eq("id", id).maybeSingle();
    return check(res, "load project") as ProjectRow | null;
  }

  async updateProject(id: string, patch: ProjectPatch): Promise<void> {
    check(await this.db.from("projects").update(patch).eq("id", id), "update project");
  }

  async listScenes(projectId: string): Promise<SceneRow[]> {
    const res = await this.db.from("scenes").select("*").eq("project_id", projectId).order("index");
    return (check(res, "load scenes") ?? []) as SceneRow[];
  }

  async replaceScenes(projectId: string, scenes: SceneInput[]): Promise<void> {
    if (scenes.length > 0) {
      const rows = scenes.map((s) => ({ ...s, project_id: projectId }));
      check(await this.db.from("scenes").upsert(rows, { onConflict: "project_id,index" }), "save scenes");
    }
    check(
      await this.db.from("scenes").delete().eq("project_id", projectId).gte("index", scenes.length),
      "trim scenes",
    );
  }

  async listExpired(nowIso: string, limit: number) {
    const res = await this.db
      .from("projects")
      .select("id, user_id, audio_path")
      .neq("status", "expired")
      .lt("output_expires_at", nowIso)
      .limit(limit);
    return (check(res, "list expired") ?? []) as Pick<ProjectRow, "id" | "user_id" | "audio_path">[];
  }

  async listStuck(statuses: readonly ProjectStatus[], beforeIso: string, limit: number) {
    const res = await this.db
      .from("projects")
      .select("id")
      .in("status", [...statuses])
      .lt("updated_at", beforeIso)
      .limit(limit);
    return (check(res, "list stuck") ?? []) as Pick<ProjectRow, "id">[];
  }
}

export class SupabaseAssetStore implements AssetStore {
  constructor(private readonly db: SupabaseClient) {}

  async list(bucket: string, prefix: string): Promise<string[]> {
    const names: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await this.db.storage.from(bucket).list(prefix, { limit: 1000, offset });
      const page = check(res, `list ${bucket}/${prefix}`) ?? [];
      // Folders come back with id === null.
      names.push(...page.filter((o) => o.id !== null).map((o) => o.name));
      if (page.length < 1000) return names;
    }
  }

  async download(bucket: string, objectPath: string, localFile: string): Promise<boolean> {
    const res = await this.db.storage.from(bucket).download(objectPath);
    if (res.error || !res.data) return false;
    await fsp.mkdir(path.dirname(localFile), { recursive: true });
    await fsp.writeFile(localFile, new Uint8Array(await res.data.arrayBuffer()));
    return true;
  }

  async upload(bucket: string, objectPath: string, localFile: string, contentType: string): Promise<void> {
    const body = fs.readFileSync(localFile);
    check(
      await this.db.storage.from(bucket).upload(objectPath, body, { contentType, upsert: true }),
      `upload ${bucket}/${objectPath}`,
    );
  }

  async remove(bucket: string, objectPaths: string[]): Promise<void> {
    for (let i = 0; i < objectPaths.length; i += 500) {
      check(
        await this.db.storage.from(bucket).remove(objectPaths.slice(i, i + 500)),
        `remove from ${bucket}`,
      );
    }
  }
}
