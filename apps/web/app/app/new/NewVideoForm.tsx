"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CUSTOM_STYLE_ID,
  DEFAULT_VOICE_ID,
  LIMITS,
  STYLE_OPTIONS,
  VOICES,
  customStyleProblem,
  type Aspect,
} from "@inkcut/shared";
import { Stickman } from "@/components/Stickman";
import { StyleSwatch } from "@/components/StyleSwatch";
import { Button, Card } from "@/components/ui";
import { audioExtension } from "@/lib/validation";
import { browserSupabase } from "@/lib/supabase/client";

type Mode = "topic" | "script" | "audio";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "topic", label: "Topic", hint: "Inkcut writes the script" },
  { id: "script", label: "My script", hint: "Paste your own words" },
  { id: "audio", label: "My voiceover", hint: "Upload a recording" },
];

async function post(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

function audioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(audio.src);
      resolve(audio.duration);
    };
    audio.onerror = () => reject(new Error("Could not read that audio file"));
    audio.src = URL.createObjectURL(file);
  });
}

export function NewVideoForm({ canAnimate, videosLeft }: { canAnimate: boolean; videosLeft: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("topic");
  const [topic, setTopic] = useState("");
  const [minutes, setMinutes] = useState(1);
  const [script, setScript] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [styleId, setStyleId] = useState(STYLE_OPTIONS[0]!.id);
  const [customStyle, setCustomStyle] = useState("");
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [captions, setCaptions] = useState(true);
  const [animate, setAnimate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function chooseFile(f: File | null) {
    setError(null);
    setFile(null);
    if (!f) return;
    if (!audioExtension(f.name)) return setError("Choose an .mp3, .wav or .m4a file.");
    if (f.size > LIMITS.maxUploadAudioBytes) return setError("That file is larger than 25 MB.");
    try {
      const seconds = await audioDuration(f);
      if (seconds > LIMITS.maxUploadAudioSec) return setError("Voiceovers can be up to 5 minutes long.");
    } catch {
      // Some formats can't be measured in the browser; the server checks again.
    }
    setFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const isCustom = styleId === CUSTOM_STYLE_ID;
      if (isCustom) {
        const problem = customStyleProblem(customStyle, LIMITS.maxCustomStyleChars);
        if (problem) throw new Error(problem);
      }
      let audioPath: string | undefined;
      if (mode === "audio") {
        if (!file) throw new Error("Choose your voiceover file first.");
        setBusy("Uploading your voiceover…");
        const up = await post("/api/uploads/voiceover", { fileName: file.name, size: file.size });
        if (!up.ok) throw new Error(String(up.data.error ?? "Upload failed"));
        const { error: upErr } = await browserSupabase()
          .storage.from("uploads")
          .uploadToSignedUrl(String(up.data.path), String(up.data.token), file);
        if (upErr) throw new Error(upErr.message);
        audioPath = String(up.data.path);
      }

      setBusy("Creating your video…");
      const common = {
        styleId,
        ...(isCustom ? { customStyle: customStyle.trim() } : {}),
        aspect,
        voiceId,
        captions,
        animate: canAnimate && animate,
      };
      const body =
        mode === "topic"
          ? { mode, topic, minutes, ...common }
          : mode === "script"
            ? { mode, script, ...common }
            : { mode, audioPath, ...common };
      const created = await post("/api/projects", body);
      if (!created.ok) throw new Error(String(created.data.error ?? "Could not create the video"));
      const id = String(created.data.id);

      setBusy("Starting…");
      const started = await post(`/api/projects/${id}/generate`);
      if (!started.ok) throw new Error(String(started.data.error ?? "Could not start the video"));
      router.push(`/app/p/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  const field =
    "w-full rounded-xl border-2 border-ink bg-white px-3 py-2.5 outline-none focus:shadow-[3px_3px_0_0_var(--color-marker)]";

  return (
    <form onSubmit={submit} className="mt-6 space-y-6">
      <Card>
        <h2 className="font-display text-lg">1. What is the video about?</h2>
        <div className="mt-4 grid grid-cols-3 gap-2" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-xl border-2 border-ink px-2 py-2.5 text-left transition ${mode === m.id ? "bg-marker shadow-[3px_3px_0_0_var(--color-ink)]" : "bg-white hover:bg-paper-2"}`}
            >
              <span className="block font-display text-sm sm:text-base">{m.label}</span>
              <span className="hidden text-xs text-ink-2 sm:block">{m.hint}</span>
            </button>
          ))}
        </div>

        {mode === "topic" ? (
          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="topic" className="text-sm font-semibold">
                Topic
              </label>
              <input
                id="topic"
                className={`${field} mt-1`}
                required
                minLength={3}
                maxLength={300}
                placeholder="Why we procrastinate"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            <div>
              <span className="text-sm font-semibold">Length</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {Array.from({ length: LIMITS.maxVideoMinutes }, (_, i) => i + 1).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMinutes(m)}
                    className={`rounded-lg border-2 border-ink px-3 py-1.5 text-sm font-bold ${minutes === m ? "bg-ink text-paper" : "bg-white"}`}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {mode === "script" ? (
          <div className="mt-5">
            <label htmlFor="script" className="text-sm font-semibold">
              Your script
            </label>
            <textarea
              id="script"
              className={`${field} mt-1 min-h-56`}
              required
              maxLength={LIMITS.maxScriptChars}
              placeholder="Paste the narration exactly as it should be spoken."
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
            <p className="mt-1 text-right text-xs text-muted">
              {script.length.toLocaleString("en")} / {LIMITS.maxScriptChars.toLocaleString("en")} characters
            </p>
          </div>
        ) : null}

        {mode === "audio" ? (
          <div className="mt-5">
            <label
              htmlFor="voiceover"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ink bg-paper px-4 py-8 text-center hover:bg-paper-2"
            >
              <Stickman pose="sit" size={70} />
              <span className="font-display">{file ? file.name : "Choose your voiceover"}</span>
              <span className="text-xs text-muted">MP3, WAV or M4A · up to 5 minutes · 25 MB</span>
            </label>
            <input
              id="voiceover"
              type="file"
              accept=".mp3,.wav,.m4a,audio/*"
              className="sr-only"
              onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)}
            />
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="font-display text-lg">2. How should it look and sound?</h2>
        <span className="mt-4 block text-sm font-semibold">Art style</span>
        <div className="mt-1 grid gap-3 sm:grid-cols-2">
          {[
            ...STYLE_OPTIONS,
            { id: CUSTOM_STYLE_ID, name: "Custom style", description: "Describe any cartoon look you want." },
          ].map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={styleId === s.id}
              onClick={() => setStyleId(s.id)}
              className={`flex items-center gap-3 rounded-xl border-2 border-ink p-3 text-left ${styleId === s.id ? "bg-marker" : "bg-white hover:bg-paper-2"}`}
            >
              <StyleSwatch styleId={s.id} />
              <span>
                <span className="block font-display">{s.name}</span>
                <span className="text-xs text-ink-2">{s.description}</span>
              </span>
            </button>
          ))}
        </div>

        {styleId === CUSTOM_STYLE_ID ? (
          <div className="mt-4">
            <label htmlFor="custom-style" className="text-sm font-semibold">
              Describe the look
            </label>
            <textarea
              id="custom-style"
              className={`${field} mt-1 min-h-24`}
              required
              minLength={3}
              maxLength={LIMITS.maxCustomStyleChars}
              placeholder="1950s retro cartoon, muted colours, thick outlines"
              value={customStyle}
              onChange={(e) => setCustomStyle(e.target.value)}
            />
            <p className="mt-1 flex justify-between gap-3 text-xs text-muted">
              <span>Describe colours, lines and mood. Don&apos;t name studios or shows.</span>
              <span className="shrink-0">
                {customStyle.length} / {LIMITS.maxCustomStyleChars}
              </span>
            </p>
          </div>
        ) : null}

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <span className="text-sm font-semibold">Shape</span>
            <div className="mt-1 flex gap-2">
              {(["16:9", "9:16"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAspect(a)}
                  className={`flex items-center gap-2 rounded-lg border-2 border-ink px-3 py-2 text-sm font-bold ${aspect === a ? "bg-ink text-paper" : "bg-white"}`}
                >
                  <span
                    className={`inline-block border-2 border-current ${a === "16:9" ? "h-3 w-5" : "h-5 w-3"}`}
                  />
                  {a === "16:9" ? "16:9 YouTube" : "9:16 Shorts"}
                </button>
              ))}
            </div>
          </div>
          {mode !== "audio" ? (
            <div>
              <label htmlFor="voice" className="text-sm font-semibold">
                Voice
              </label>
              <select
                id="voice"
                className={`${field} mt-1`}
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className="mt-5 space-y-3">
          <label className="flex items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              className="size-5 accent-ink"
              checked={captions}
              onChange={(e) => setCaptions(e.target.checked)}
            />
            Burn in captions
          </label>
          {canAnimate ? (
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                className="size-5 accent-ink"
                checked={animate}
                onChange={(e) => setAnimate(e.target.checked)}
              />
              Animate scenes (admin only, uses pollen)
            </label>
          ) : null}
        </div>
      </Card>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border-2 border-[#9b2c17] bg-[#ffe1db] px-4 py-3 text-sm text-[#9b2c17]"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          variant="marker"
          className="px-7 py-3 text-lg"
          disabled={Boolean(busy) || videosLeft <= 0}
        >
          {busy ?? "Generate video"}
        </Button>
        <p className="text-sm text-muted">
          {videosLeft > 0
            ? "Takes a few minutes. You can leave this page; the video keeps going."
            : "You've used today's free videos. Come back tomorrow!"}
        </p>
      </div>
    </form>
  );
}
