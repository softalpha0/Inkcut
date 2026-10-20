import type { ProjectRow, SceneRow } from "@inkcut/db";
import type { ProjectStatus } from "@inkcut/shared";
import type { ProjectPatch, ProjectStore, SceneInput } from "../src/stores.js";

/** In-memory ProjectStore that records every status change. */
export class MemoryProjectStore implements ProjectStore {
  projects = new Map<string, ProjectRow>();
  scenes = new Map<string, SceneRow[]>();
  statusLog: string[] = [];

  add(row: Partial<ProjectRow> & Pick<ProjectRow, "id" | "user_id" | "input_mode">): ProjectRow {
    const now = new Date().toISOString();
    const full: ProjectRow = {
      title: "Test",
      topic: null,
      script: null,
      minutes: 1,
      audio_path: null,
      style_id: "stickman-classic",
      aspect: "16:9",
      voice_id: "en-US-GuyNeural",
      captions: true,
      animate: false,
      status: "queued",
      current_stage: null,
      error: null,
      output_path: null,
      output_expires_at: null,
      created_at: now,
      updated_at: now,
      ...row,
    };
    this.projects.set(full.id, full);
    return full;
  }

  async getProject(id: string) {
    return this.projects.get(id) ?? null;
  }

  async updateProject(id: string, patch: ProjectPatch) {
    const row = this.projects.get(id);
    if (!row) return;
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    if (patch.status) this.statusLog.push(patch.status);
  }

  async listScenes(projectId: string) {
    return structuredClone(this.scenes.get(projectId) ?? []);
  }

  async replaceScenes(projectId: string, scenes: SceneInput[]) {
    this.scenes.set(
      projectId,
      scenes.map((s) => ({ ...s, id: `${projectId}-${s.index}`, project_id: projectId, updated_at: "" })),
    );
  }

  async listExpired(nowIso: string, limit: number) {
    return [...this.projects.values()]
      .filter((p) => p.status !== "expired" && p.output_expires_at && p.output_expires_at < nowIso)
      .slice(0, limit)
      .map((p) => ({ id: p.id, user_id: p.user_id, audio_path: p.audio_path }));
  }

  async listStuck(statuses: readonly ProjectStatus[], beforeIso: string, limit: number) {
    return [...this.projects.values()]
      .filter((p) => statuses.includes(p.status) && p.updated_at < beforeIso)
      .slice(0, limit)
      .map((p) => ({ id: p.id }));
  }
}
