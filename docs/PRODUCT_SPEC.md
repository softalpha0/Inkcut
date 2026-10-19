# Inkcut — Product & Technical Specification

> Product name: **Inkcut**
> Version: v1 (MVP) · Owner: Benjamin · Status: Ready for build

---

## 1. Overview

Inkcut turns a **topic** or a **script** into a narrated, illustrated, faceless explainer video (stickman style first). The user previews the scenes, can redraw any single scene, then **downloads the MP4** and posts it themselves.

- **Free to use** in v1 (no payments, no credits).
- **No auto-posting** to YouTube or any platform.
- First users: the owner's own channels (stickman history + stickman psychology explainers), then the public.

### 1.1 Reference product
vsub.io — script/voiceover → scenes → narration → AI-drawn frames in a chosen style → stitched video. We copy the core loop, not the full template catalogue.

### 1.2 Differentiation
1. Focused niche: stickman explainers done well, instead of 20 mediocre styles.
2. Reasoning layer runs on **SERV Reasoning** (OpenServ), keeping per-video LLM cost low.
3. Free, with fair usage limits.

---

## 2. Scope

### 2.1 In scope (v1)

| # | Feature | Notes |
|---|---|---|
| 1 | Topic → script | SERV writes narration from a topic + target length |
| 2 | Paste own script | Skip script generation |
| 3 | Upload own voiceover | Transcribe with Whisper, use audio as-is |
| 4 | Script → scenes | SERV splits into scenes with image prompts |
| 5 | AI voice | Free TTS (Edge TTS) with a few voice options |
| 6 | Image generation | Stickman style presets, consistent look |
| 7 | Scene editor | View scenes, edit prompt, redraw one scene |
| 8 | Render | Ken Burns motion, burned-in captions, background music optional |
| 9 | Aspect ratios | 16:9 (1920×1080) and 9:16 (1080×1920) |
| 10 | Download MP4 | Signed URL, file kept 48 hours |
| 11 | Auth | Email magic link / Google via Supabase |
| 12 | Usage limits | Per-user daily caps (see §8) |

### 2.2 Out of scope (v1)
- Payments, credits, subscriptions
- Posting to YouTube/TikTok
- Cloning a style from a reference video
- Public API / MCP server
- Team workspaces

---

## 3. User flow

1. User signs in.
2. **New video** → chooses input mode:
   - (a) Topic + target length (1–5 min)
   - (b) Paste script
   - (c) Upload voiceover (mp3/wav/m4a, ≤ 5 min)
3. Chooses **style preset**, **aspect ratio**, **voice** (not for mode c), captions on/off.
4. Clicks **Generate**. Progress screen shows each stage live.
5. Lands on **Scene editor**: grid of scenes (image + narration text + duration).
   - Edit narration text → re-voices that scene only.
   - Edit image prompt → **Redraw** that scene only.
6. Clicks **Render** → final MP4 → **Download**.

---

## 4. Architecture

```
┌──────────────┐   REST    ┌──────────────────┐  enqueue  ┌──────────────┐
│  Next.js web │ ───────▶  │ Next.js API routes│ ───────▶ │ Redis/BullMQ │
│  (Vercel)    │ ◀──────── │  (Vercel)         │          └──────┬───────┘
└──────┬───────┘  realtime └────────┬─────────┘                  │ consume
       │                            │                    ┌───────▼────────┐
       │        Supabase (Auth, Postgres, Storage)  ◀─── │ Worker (Node + │
       └───────────────────────────────────────────────▶ │ FFmpeg) Railway│
                                                         └───────┬────────┘
                                         ┌───────────────────────┼─────────────────┐
                                    SERV Reasoning        Image provider       Edge TTS / Whisper
```

### 4.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + TypeScript | Shared types between web and worker |
| Web | Next.js (App Router) + Tailwind | Fast to build; deployed on Render |
| Auth/DB/Storage | Supabase | Free tier, Postgres + RLS + file storage + realtime |
| Queue | BullMQ + Redis (Render Key Value) | Long jobs can't run in serverless functions |
| Worker | Node 22 + FFmpeg (Docker on Render) | Rendering takes minutes |
| LLM | SERV Reasoning via OpenAI SDK (`baseURL` swap) | Cheap, structured reasoning |
| Images | Provider interface: fal.ai Flux Schnell (default), Replicate, Pollinations | Swap without code changes |
| TTS | Edge TTS (free) behind a provider interface | Free; ElevenLabs can be added later |
| Transcription | Whisper (provider interface; OpenAI-compatible or local) | For uploaded voiceovers + caption timing |
| Validation | zod | All LLM JSON output is validated |
| Tests | vitest | Unit + pipeline tests with mocked providers |

### 4.2 Repo layout

```
inkcut/
├─ apps/
│  ├─ web/                 # Next.js app + API routes
│  └─ worker/              # BullMQ consumer, runs the pipeline
├─ packages/
│  ├─ pipeline/            # Core: script → scenes → audio → images → video
│  │  ├─ src/llm/          # SERV client + prompts
│  │  ├─ src/tts/          # TTS providers
│  │  ├─ src/images/       # Image providers
│  │  ├─ src/stt/          # Whisper providers
│  │  ├─ src/render/       # FFmpeg composition
│  │  ├─ src/styles/       # Style presets
│  │  └─ src/cli.ts        # Local CLI entry
│  ├─ shared/              # Types, zod schemas, constants, limits
│  └─ db/                  # SQL migrations + typed Supabase client
├─ docs/
│  └─ PRODUCT_SPEC.md
├─ CLAUDE.md
├─ .env.example
└─ package.json
```

---

## 5. Generation pipeline

Every stage is **idempotent and resumable**: outputs are saved after each stage, so a retry continues from the failed stage and never regenerates finished assets.

| Stage | Input | Output | Service |
|---|---|---|---|
| 1. `script` | topic, target minutes | narration text (~150 words/min) | SERV |
| 2. `transcribe` (mode c only) | uploaded audio | text + word timestamps | Whisper |
| 3. `plan` | narration, style | `Scene[]` (JSON, zod-validated) | SERV |
| 4. `voice` | scene narration | one audio file per scene + measured duration | Edge TTS + ffprobe |
| 5. `draw` | scene image prompt + style | one image per scene | Image provider |
| 6. `render` | images + audio + captions | final MP4 | FFmpeg |

### 5.1 Scene schema

```ts
Scene {
  index: number;              // 0-based order
  narration: string;          // text spoken in this scene
  visual: string;             // plain description of what is shown
  imagePrompt: string;        // final prompt sent to image model (style applied later)
  motion: "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "static";
  durationSec?: number;       // filled after voice stage
  audioPath?: string;
  imagePath?: string;
}
```

Planning rules (enforced in the SERV prompt + validation):
- 1 scene ≈ 1–2 sentences ≈ 4–8 seconds of speech.
- A 5-minute video → roughly 40–70 scenes.
- `imagePrompt` describes **one clear moment**, no text inside images, same recurring characters described the same way every time.
- Invalid JSON → retry up to 2 times with the validation error fed back.

### 5.2 Voice
- **Modes a/b:** TTS per scene → exact duration from ffprobe. Scenes are concatenated with no gaps (optional 0.15 s pause).
- **Mode c:** keep the uploaded audio. Use Whisper word timestamps to cut scenes on sentence boundaries; scene duration = timestamp span.

### 5.3 Style consistency
Each style preset in `packages/pipeline/src/styles/` defines:

```ts
StylePreset {
  id: string;                 // "stickman-classic"
  name: string;
  promptPrefix: string;       // e.g. "minimal black stickman drawing, thick clean lines, flat pastel background, ..."
  negativePrompt: string;
  seed?: number;              // fixed seed per project for consistency
  characterSheet?: string;    // standard description of recurring characters
}
```

v1 presets: `stickman-classic` (white background, black lines), `stickman-color` (flat colors, simple scenery).

### 5.4 Render (FFmpeg)
1. For each scene: image → clip of `durationSec` with `zoompan` motion at 30 fps, target resolution.
2. Concatenate clips (concat demuxer).
3. Concatenate scene audio → single narration track; optional music bed at −20 dB with ducking.
4. Captions: generate `.ass` file (2–5 words per line, timed by scene or word timestamps), burn in with `subtitles` filter.
5. Output H.264 / AAC, `-movflags +faststart`.

Must work on Windows (local dev) and Linux (worker Docker). Use `ffmpeg-static` + `ffprobe-static` locally; system FFmpeg in Docker.

---

## 6. Data model (Supabase Postgres)

```sql
profiles      (id uuid pk = auth.users.id, created_at)
projects      (id uuid pk, user_id fk, title, input_mode text, topic text, script text,
               style_id text, aspect text, voice_id text, captions bool,
               status text, current_stage text, error text,
               output_path text, output_expires_at timestamptz,
               created_at, updated_at)
scenes        (id uuid pk, project_id fk, index int, narration text, visual text,
               image_prompt text, motion text, duration_sec numeric,
               audio_path text, image_path text, updated_at)
usage_daily   (user_id fk, day date, videos_started int, redraws int, pk(user_id, day))
```

- `status`: `draft | queued | scripting | planning | voicing | drawing | rendering | done | failed`
- Row Level Security: users read/write only their own rows. Worker uses the service role key.
- Storage buckets: `uploads/`, `assets/` (scene audio + images), `outputs/` (MP4). All private; downloads via signed URLs.

---

## 7. API (Next.js route handlers)

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/projects` | Create project (validates limits) |
| GET | `/api/projects` | List my projects |
| GET | `/api/projects/:id` | Project + scenes |
| POST | `/api/projects/:id/generate` | Enqueue full pipeline |
| POST | `/api/projects/:id/retry` | Resume from failed stage |
| PATCH | `/api/scenes/:id` | Edit narration or image prompt |
| POST | `/api/scenes/:id/redraw` | Enqueue single-scene redraw |
| POST | `/api/scenes/:id/revoice` | Enqueue single-scene re-voice |
| POST | `/api/projects/:id/render` | Enqueue render only |
| GET | `/api/projects/:id/download` | Signed URL for MP4 |
| POST | `/api/uploads/voiceover` | Signed upload URL |

Progress: worker updates `projects.status/current_stage`; web subscribes via Supabase Realtime.

---

## 8. Limits & cost control (free tier)

| Limit | Value | Where enforced |
|---|---|---|
| Videos started per user per day | 3 | API + DB (`usage_daily`) |
| Max video length | 5 min | API validation |
| Max script length | 6,000 characters | API validation |
| Scene redraws per user per day | 30 | API |
| Uploaded audio | ≤ 5 min, ≤ 25 MB | API + worker |
| Output retention | 48 h, then deleted by a cleanup job | Worker cron |
| Concurrent jobs per user | 1 | Queue job ID by user |

All limits live in `packages/shared/src/limits.ts` so they can change in one place.

---

## 9. Environment variables (`.env.example`)

```
# SERV Reasoning (OpenAI-compatible)
SERV_API_KEY=
SERV_BASE_URL=https://inference-api.openserv.ai/v1
SERV_MODEL=gpt-5.4-mini

# Images
IMAGE_PROVIDER=fal            # fal | replicate | pollinations
FAL_KEY=
REPLICATE_API_TOKEN=

# Speech
TTS_PROVIDER=edge             # edge
STT_PROVIDER=openai           # openai | local
STT_API_KEY=
STT_BASE_URL=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Queue
REDIS_URL=
```

Confirm the exact SERV model names and image/TTS package APIs from their current docs before coding against them.

---

## 10. Milestones & acceptance criteria

### M1 — Local CLI pipeline
`pnpm cli --topic "Why we procrastinate" --minutes 1 --style stickman-classic --aspect 16:9`
- [ ] Produces `out/<id>/final.mp4` playable in VLC, on Windows.
- [ ] Captions burned in and in sync (±0.3 s).
- [ ] Re-running after a forced failure at `draw` resumes without re-calling SERV or TTS.
- [ ] `--script file.txt` and `--audio file.mp3` modes work.
- [ ] Unit tests for scene schema validation, duration math, ASS caption generation.

### M2 — Worker + queue
- [ ] Worker consumes jobs from BullMQ, runs the pipeline, writes assets to Supabase Storage.
- [ ] Project status updates per stage; failures store the error message.
- [ ] Single-scene redraw and re-voice jobs.
- [ ] Dockerfile for worker with FFmpeg.

### M3 — Web app
- [ ] Auth (magic link + Google).
- [ ] New-video form with all three input modes.
- [ ] Live progress screen.
- [ ] Scene editor with edit / redraw / re-voice.
- [ ] Render + download.
- [ ] Mobile-friendly layout.

### M4 — Limits, cleanup, deploy
- [ ] All limits in §8 enforced and shown in UI ("2 of 3 videos left today").
- [ ] 48-hour cleanup cron.
- [ ] Web, worker and Redis (Key Value) on Render via `render.yaml` (changed from Vercel/Railway/Upstash by the developer).
- [ ] README with full setup + deploy steps.

---

## 11. Non-functional requirements
- No API keys in client code or commits.
- All external calls have timeouts and retry with backoff (max 3).
- Structured logs with project ID on every line.
- Provider interfaces so any model/service can be swapped by env var.
- Target: a 3-minute video renders in under 10 minutes end to end.

## 12. Future (post-v1)
1. Clone style from a reference video
2. More presets (paper diorama, cartoon, history map)
3. Background music library
4. Public API + MCP server
5. Paid tier / bring-your-own-key
