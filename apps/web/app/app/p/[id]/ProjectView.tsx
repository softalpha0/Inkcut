"use client";
import { useCallback, useEffect, useState } from "react";
import { ACTIVE_STATUSES, LIMITS } from "@inkcut/shared";
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

interface ThumbnailView {
  index: number;
  headline: string;
  url: string | null;
  cleanUrl: string | null;
}

interface YoutubeView {
  titles: string[];
  description: string;
  tags: string[];
  hashtags: string[];
  pinnedComment: string;
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
  thumbnails: ThumbnailView[];
  youtube: YoutubeView | null;
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

  const { project, scenes, videoUrl, thumbnails, youtube } = data;
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

      {project.status === "done" && (thumbnails.length === 0 || !youtube) && scenes.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-display text-lg">Get it ready for YouTube</p>
            <p className="text-sm text-ink-2">
              {thumbnails.length === 0 ? "Three click-worthy thumbnails plus titles" : "Titles"}, description,
              tags and a pinned comment. Takes about a minute.
            </p>
          </div>
          <Button onClick={() => void act(`/api/projects/${project.id}/extras`)}>
            {thumbnails.length === 0 ? "Make thumbnails & details" : "Write YouTube details"}
          </Button>
        </Card>
      ) : null}

      {thumbnails.length > 0 ? (
        <section>
          <h2 className="font-display text-2xl">Thumbnails</h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            Three different hooks for the same video. Upload all three in YouTube Studio under{" "}
            <strong>Test &amp; compare</strong>: YouTube shows each to different viewers and keeps the one
            that gets the most clicks. Put <strong>*stars*</strong> around the word you want in yellow.
          </p>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            {thumbnails.map((t) => (
              <ThumbnailEditor
                key={`${t.index}-${t.headline}-${t.url ?? ""}`}
                projectId={project.id}
                thumb={t}
                title={youtube?.titles[t.index] ?? null}
                disabled={active || project.status === "expired"}
                act={act}
              />
            ))}
          </div>
        </section>
      ) : null}

      {youtube && !active ? <YoutubeDetails kit={youtube} /> : null}

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

function ThumbnailEditor({
  projectId,
  thumb,
  title,
  disabled,
  act,
}: {
  projectId: string;
  thumb: ThumbnailView;
  /** The YouTube title written to go with this thumbnail. */
  title: string | null;
  disabled: boolean;
  act: (url: string, method?: string, body?: unknown) => Promise<boolean>;
}) {
  const [headline, setHeadline] = useState(thumb.headline);
  const dirty = headline.trim() !== thumb.headline && headline.trim().length > 0;
  const base = `/api/projects/${projectId}/thumbnails/${thumb.index}`;
  const link =
    "inline-flex items-center rounded-lg border-2 border-ink bg-white px-3 py-1.5 text-sm font-bold hover:bg-paper-2";

  return (
    <article className="overflow-hidden rounded-2xl border-2 border-ink bg-white shadow-[4px_4px_0_0_var(--color-ink)]">
      <div className="relative aspect-video bg-paper-2">
        {thumb.url ? (
          <img src={thumb.url} alt={`Thumbnail ${thumb.index + 1}`} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-sm text-muted">Not ready yet</div>
        )}
        <span className="absolute left-2 top-2 rounded-md border-2 border-ink bg-white px-2 py-0.5 text-xs font-bold">
          {thumb.index + 1}
        </span>
      </div>
      <div className="space-y-3 p-4">
        {title ? (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">
                Title for this thumbnail
              </span>
              <CopyButton text={title} />
            </div>
            <p className="mt-1 font-semibold leading-snug">{title}</p>
          </div>
        ) : null}
        <label className="block text-xs font-bold uppercase tracking-wide text-muted">
          Headline
          <input
            className="mt-1 w-full rounded-lg border-2 border-ink bg-white px-2.5 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:shadow-[2px_2px_0_0_var(--color-marker)] disabled:bg-paper-2"
            value={headline}
            disabled={disabled}
            maxLength={LIMITS.maxThumbnailHeadlineChars + 4}
            onChange={(e) => setHeadline(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {dirty ? (
            <Button
              className="px-3 py-1.5 text-sm"
              disabled={disabled}
              onClick={() => void act(base, "POST", { headline: headline.trim() })}
            >
              Update text
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-sm"
            disabled={disabled}
            onClick={() =>
              void act(base, "POST", { redraw: true, ...(dirty ? { headline: headline.trim() } : {}) })
            }
          >
            New picture
          </Button>
          <a href={`${base}/download`} className={link}>
            ⬇ Download
          </a>
          <a href={`${base}/download?clean=1`} className={`${link} font-semibold text-ink-2`}>
            No text
          </a>
        </div>
      </div>
    </article>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. insecure context): the text is still on screen to select.
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="shrink-0 rounded-md border-2 border-ink bg-white px-2 py-0.5 text-xs font-bold hover:bg-paper-2"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

/** Titles, description, tags and pinned comment, ready to paste into YouTube Studio. */
function YoutubeDetails({ kit }: { kit: YoutubeView }) {
  const description = `${kit.description}\n\n${kit.hashtags.join(" ")}`;
  const tags = kit.tags.join(", ");
  const block = "rounded-xl border-2 border-ink bg-white p-4";
  const heading = "flex items-center justify-between gap-2";
  const label = "text-xs font-bold uppercase tracking-wide text-muted";

  return (
    <section>
      <h2 className="font-display text-2xl">YouTube details</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        Copy these into YouTube Studio. Each title goes with the thumbnail of the same number in{" "}
        <strong>A/B Testing</strong>.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className={block}>
          <span className={label}>Titles</span>
          <ol className="mt-2 space-y-2">
            {kit.titles.map((t, i) => (
              <li key={i} className="flex items-start justify-between gap-3">
                <span className="font-semibold leading-snug">
                  {i + 1}. {t}
                </span>
                <CopyButton text={t} />
              </li>
            ))}
          </ol>
        </div>
        <div className={block}>
          <div className={heading}>
            <span className={label}>Pinned comment</span>
            <CopyButton text={kit.pinnedComment} />
          </div>
          <p className="mt-2">{kit.pinnedComment}</p>
        </div>
        <div className={`${block} md:col-span-2`}>
          <div className={heading}>
            <span className={label}>Description</span>
            <CopyButton text={description} />
          </div>
          <p className="mt-2 whitespace-pre-line text-sm">{description}</p>
        </div>
        <div className={`${block} md:col-span-2`}>
          <div className={heading}>
            <span className={label}>Tags</span>
            <CopyButton text={tags} />
          </div>
          <p className="mt-2 text-sm text-ink-2">{tags}</p>
        </div>
      </div>
    </section>
  );
}
