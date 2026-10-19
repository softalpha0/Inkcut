"use client";
import { useCallback, useEffect, useState } from "react";
import { ACTIVE_STATUSES } from "@inkcut/shared";
import { Stickman } from "@/components/Stickman";
import { Button, Card, StatusBadge, statusLabel } from "@/components/ui";
import { browserSupabase } from "@/lib/supabase/client";

interface SceneView {
  id: string;
  index: number;
  narration: string;
  imagePrompt: string;
  durationSec: number | null;
  imageUrl: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
}

interface ProjectData {
  project: {
    id: string;
    title: string;
    status: string;
    current_stage: string | null;
    error: string | null;
    input_mode: "topic" | "script" | "audio";
    aspect: string;
    animate: boolean;
    output_expires_at: string | null;
  };
  videoUrl: string | null;
  scenes: SceneView[];
}

const STAGES: Record<string, string[]> = {
  topic: ["scripting", "planning", "voicing", "drawing", "rendering"],
  script: ["planning", "voicing", "drawing", "rendering"],
  audio: ["transcribing", "planning", "drawing", "rendering"],
};

async function call(url: string, method = "POST", body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${res.status})`;
}

export function ProjectView({ id }: { id: string }) {
  const [data, setData] = useState<ProjectData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
    if (res.ok) setData((await res.json()) as ProjectData);
  }, [id]);

  const active = data ? (ACTIVE_STATUSES as readonly string[]).includes(data.project.status) : true;

  useEffect(() => {
    void load();
    // Live updates from Supabase Realtime, with polling as a fallback.
    const supabase = browserSupabase();
    const channel = supabase
      .channel(`project-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter: `id=eq.${id}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, load]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [active, load]);

  async function act(url: string, method = "POST", body?: unknown) {
    setError(null);
    const err = await call(url, method, body);
    if (err) setError(err);
    await load();
    return !err;
  }

  if (!data) {
    return (
      <div className="grid place-items-center py-24">
        <Stickman pose="think" size={100} className="animate-bob" />
      </div>
    );
  }

  const { project, scenes, videoUrl } = data;
  const vertical = project.aspect === "9:16";
  const stages = [...STAGES[project.input_mode]!];
  if (project.animate) stages.splice(stages.indexOf("rendering"), 0, "animating");
  const currentIdx = stages.indexOf(project.status);
  const hoursLeft = project.output_expires_at
    ? Math.max(0, Math.round((new Date(project.output_expires_at).getTime() - Date.now()) / 3600_000))
    : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <StatusBadge status={project.status} />
          <h1 className="mt-2 font-display text-3xl">{project.title}</h1>
        </div>
        {project.status === "done" ? (
          <a
            href={`/api/projects/${project.id}/download`}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-ink bg-marker px-5 py-2.5 font-display shadow-[3px_3px_0_0_var(--color-ink)]"
          >
            ⬇ Download MP4
          </a>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border-2 border-[#9b2c17] bg-[#ffe1db] px-4 py-3 text-sm text-[#9b2c17]"
        >
          {error}
        </p>
      ) : null}

      {active ? (
        <Card>
          <div className="flex flex-wrap items-center gap-6">
            <Stickman pose="walk" size={90} className="animate-bob" />
            <div className="flex-1">
              <p className="font-display text-xl">
                {project.status === "queued"
                  ? "Waiting for a free worker…"
                  : `${statusLabel(project.status)}…`}
              </p>
              <p className="text-sm text-ink-2">This usually takes a few minutes. You can leave this page.</p>
              <ol className="mt-4 flex flex-wrap gap-2">
                {stages.map((s, i) => (
                  <li
                    key={s}
                    className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-bold ${i < currentIdx ? "bg-ink text-paper" : i === currentIdx ? "bg-marker" : "bg-white text-muted"}`}
                  >
                    {i < currentIdx ? "✓ " : ""}
                    {statusLabel(s)}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Card>
      ) : null}

      {project.status === "failed" ? (
        <Card className="border-[#9b2c17]">
          <p className="font-display text-lg">Something went wrong</p>
          <p className="mt-1 text-sm text-ink-2">{project.error ?? "Unknown error"}</p>
          <p className="mt-1 text-sm text-ink-2">
            Retrying continues from where it stopped; finished steps are kept.
          </p>
          <Button className="mt-4" onClick={() => void act(`/api/projects/${project.id}/retry`)}>
            Retry
          </Button>
        </Card>
      ) : null}

      {project.status === "draft" && scenes.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 bg-marker/30">
          <p className="font-semibold">Scenes changed. Render to update the video.</p>
          <Button onClick={() => void act(`/api/projects/${project.id}/render`)}>Render video</Button>
        </Card>
      ) : null}

      {project.status === "expired" ? (
        <Card>
          <p className="font-display text-lg">This video expired</p>
          <p className="text-sm text-ink-2">
            Videos are deleted 48 hours after rendering. Make a new one anytime.
          </p>
        </Card>
      ) : null}

      {videoUrl && project.status === "done" ? (
        <div className={vertical ? "mx-auto max-w-sm" : ""}>
          <video
            key={videoUrl}
            src={videoUrl}
            controls
            playsInline
            className="w-full rounded-2xl border-2 border-ink bg-black shadow-[6px_6px_0_0_var(--color-ink)]"
          />
          {hoursLeft !== null ? (
            <p className="mt-3 text-center text-sm text-muted">
              Available to download for about {hoursLeft} more hours.
            </p>
          ) : null}
        </div>
      ) : null}

      {scenes.length > 0 ? (
        <section>
          <h2 className="font-display text-2xl">Scenes</h2>
          <p className="mt-1 text-sm text-ink-2">
            Edit a line or a picture prompt, then redraw or re-voice just that scene. Render again when
            you&apos;re happy.
          </p>
          <div className={`mt-5 grid gap-5 ${vertical ? "sm:grid-cols-2 lg:grid-cols-3" : "md:grid-cols-2"}`}>
            {scenes.map((s) => (
              <SceneEditor
                key={s.id}
                scene={s}
                vertical={vertical}
                disabled={active || project.status === "expired"}
                canRevoice={project.input_mode !== "audio"}
                act={act}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SceneEditor({
  scene,
  vertical,
  disabled,
  canRevoice,
  act,
}: {
  scene: SceneView;
  vertical: boolean;
  disabled: boolean;
  canRevoice: boolean;
  act: (url: string, method?: string, body?: unknown) => Promise<boolean>;
}) {
  const [narration, setNarration] = useState(scene.narration);
  const [prompt, setPrompt] = useState(scene.imagePrompt);
  const dirty = narration !== scene.narration || prompt !== scene.imagePrompt;

  useEffect(() => {
    setNarration(scene.narration);
    setPrompt(scene.imagePrompt);
  }, [scene.narration, scene.imagePrompt]);

  async function saveThen(action?: "redraw" | "revoice") {
    if (dirty) {
      const body: Record<string, string> = {};
      if (narration !== scene.narration) body.narration = narration;
      if (prompt !== scene.imagePrompt) body.imagePrompt = prompt;
      if (!(await act(`/api/scenes/${scene.id}`, "PATCH", body))) return;
    }
    if (action) await act(`/api/scenes/${scene.id}/${action}`);
  }

  const box =
    "w-full rounded-lg border-2 border-ink bg-white px-2.5 py-2 text-sm outline-none focus:shadow-[2px_2px_0_0_var(--color-marker)] disabled:bg-paper-2";

  return (
    <article className="overflow-hidden rounded-2xl border-2 border-ink bg-white shadow-[4px_4px_0_0_var(--color-ink)]">
      <div className={`relative bg-paper-2 ${vertical ? "aspect-[9/16]" : "aspect-video"}`}>
        {scene.videoUrl ? (
          <video src={scene.videoUrl} muted loop autoPlay playsInline className="size-full object-cover" />
        ) : scene.imageUrl ? (
          <img src={scene.imageUrl} alt={`Scene ${scene.index + 1}`} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-sm text-muted">Not drawn yet</div>
        )}
        <span className="absolute left-2 top-2 rounded-md border-2 border-ink bg-white px-2 py-0.5 text-xs font-bold">
          {scene.index + 1}
          {scene.durationSec ? ` · ${scene.durationSec.toFixed(1)} s` : ""}
        </span>
      </div>
      <div className="space-y-3 p-4">
        <label className="block text-xs font-bold uppercase tracking-wide text-muted">
          Narration
          <textarea
            className={`${box} mt-1 min-h-20 normal-case tracking-normal text-ink`}
            value={narration}
            disabled={disabled || !canRevoice}
            onChange={(e) => setNarration(e.target.value)}
            maxLength={600}
          />
        </label>
        <details>
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-muted">
            Picture prompt
          </summary>
          <textarea
            className={`${box} mt-1 min-h-24`}
            value={prompt}
            disabled={disabled}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={800}
          />
        </details>
        {scene.audioUrl ? (
          <audio src={scene.audioUrl} controls className="h-9 w-full" preload="none" />
        ) : null}
        <div className="flex flex-wrap gap-2">
          {dirty ? (
            <Button className="px-3 py-1.5 text-sm" disabled={disabled} onClick={() => void saveThen()}>
              Save
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-sm"
            disabled={disabled}
            onClick={() => void saveThen("redraw")}
          >
            Redraw
          </Button>
          {canRevoice ? (
            <Button
              variant="ghost"
              className="px-3 py-1.5 text-sm"
              disabled={disabled}
              onClick={() => void saveThen("revoice")}
            >
              Re-voice
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
