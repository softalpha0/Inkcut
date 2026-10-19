# Inkcut

Turn a topic, a script or your own voiceover into a narrated stickman explainer video (MP4).
Free to use, with daily limits. See [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) for scope and architecture.

```
Browser ──▶ Next.js web + API (apps/web) ──enqueue──▶ Redis queue ──▶ Worker (apps/worker, FFmpeg)
   ▲              │                                                       │
   └── Supabase Auth · Postgres (projects, scenes, limits) · Storage ◀────┘

Pipeline (packages/pipeline):
topic ─SERV─▶ script ─SERV─▶ scenes ─Edge TTS─▶ voice ─Pollinations/fal─▶ images ─(optional)─▶ animated clips ─FFmpeg─▶ final.mp4
```

| Folder              | What it is                                                                    |
| ------------------- | ----------------------------------------------------------------------------- |
| `apps/web`          | Landing page, sign-in, new-video form, progress + scene editor, API routes    |
| `apps/worker`       | Queue consumer that runs the pipeline and stores results; hourly 48 h cleanup |
| `packages/pipeline` | The video pipeline and the local CLI                                          |
| `packages/shared`   | Schemas, limits, job types shared by everything                               |
| `packages/db`       | SQL migration and Supabase helpers                                            |

---

# Part 1: Local CLI (no accounts needed except API keys)

## Requirements

- Node.js **22+**
- pnpm 10
- FFmpeg is bundled through `ffmpeg-static` / `ffprobe-static`; nothing to install.
- API keys:

| Variable               | Needed for                                                                    | Where to get it                                 |
| ---------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| `SERV_API_KEY`         | topic + script modes (script writing, scene planning)                         | console.openserv.ai → API Keys                  |
| `FAL_KEY`              | images with `IMAGE_PROVIDER=fal` (default)                                    | fal.ai → Dashboard → Keys                       |
| `POLLINATIONS_API_KEY` | images with `IMAGE_PROVIDER=pollinations` (about 0.002 pollen per Flux image) | enter.pollinations.ai → Keys (secret `sk_` key) |
| `STT_API_KEY`          | `--audio` mode only (OpenAI Whisper)                                          | platform.openai.com → API keys                  |

Edge TTS needs no key.

## Setup (Windows PowerShell)

```powershell
# 1. pnpm (once)
corepack enable
corepack prepare pnpm@10.28.0 --activate
# (or: npm install -g pnpm)

# 2. dependencies
cd C:\path\to\Inkcut
pnpm install

# 3. keys
Copy-Item .env.example .env
notepad .env        # SERV_API_KEY + an image key: FAL_KEY, or IMAGE_PROVIDER=pollinations + POLLINATIONS_API_KEY

# 4. check everything works locally (no API calls, renders two short test videos with FFmpeg)
pnpm test
```

## Usage

```powershell
# Topic -> video
pnpm cli --topic "Why we procrastinate" --minutes 1 --style stickman-classic --aspect 16:9

# Your own script (max 6,000 characters)
pnpm cli --script .\my-script.txt --style stickman-color --aspect 9:16

# Your own voiceover (.mp3/.wav/.m4a, max 5 min / 25 MB)
pnpm cli --audio .\voiceover.mp3

# Options
#   --voice en-US-AriaNeural   (en-US-GuyNeural default; also ChristopherNeural, JennyNeural, en-GB-RyanNeural, en-GB-SoniaNeural)
#   --no-captions
#   --out D:\videos            (default: .\out)
```

The video is written to `out\<projectId>\final.mp4`.

### Animated scenes (optional, paid)

`--animate` turns each scene's image into a short AI video clip (Pollinations image-to-video,
default model `bytedance/seedance-1-pro-fast` at 480p, about 0.015 pollen per second, paid pollen only).
SERV writes a small motion description per scene; the clip is fitted to the scene's exact length and
captions are burned in as usual. Scenes that fail to animate keep the free zoom/pan.

```powershell
# New video, animate at most 3 scenes (spread through the video)
pnpm cli --topic "Why we procrastinate" --minutes 1 --animate --animate-max 3

# Add animation to a finished project: only the animate and render stages run
pnpm cli --resume why-we-procrastinate-1a2b3c --animate --animate-max 2
```

The run prints the video seconds and estimated pollen before generating. Your Pollinations key needs the
**video** permission and enough budget (enter.pollinations.ai → Keys).

### Resume after a failure

Every stage saves its output and skips work that already exists, so a failed run can continue without
paying for the same calls twice:

```powershell
pnpm cli --resume why-we-procrastinate-1a2b3c
```

To test this on purpose, force a failure after 2 images, then resume:

```powershell
pnpm cli --topic "Why we procrastinate" --minutes 1 --fail-at draw:2
pnpm cli --resume <projectId printed above>
```

The resumed run prints `API calls: fal=<remaining images>` with no `serv` or `edge-tts` calls.

### Project folder

```
out\<projectId>\
  project.json        manifest: inputs, scenes, completed stages, API calls per run
  script.txt          narration
  plan.json           scenes + image prompts from SERV
  audio\NNN.mp3       per-scene narration (+ NNN.words.json word timings)
  images\NNN.png      per-scene image
  animated\NNN.mp4    per-scene animated clip (--animate only)
  render\             clips, captions.ass, narration.m4a
  final.mp4
```

To redo one asset, delete its file (for example `images\004.png`) and run `--resume`.

---

# Part 2: Deploy the website on Render

You need four free accounts: **GitHub**, **Supabase**, **Render** and (for Google sign-in) **Google Cloud**.
Render's background worker is the only paid part (Starter plan, about $7/month). Everything else here is on free plans.

## Step 1: Put the code on GitHub

Render deploys from a GitHub repository. From `C:\dev\Inkcut` in PowerShell (one time):

```powershell
git init
git add -A
git commit -m "Inkcut"
git branch -M main
git remote add origin https://github.com/softalpha0/Inkcut.git
git push -u origin main
```

(`.env` is git-ignored, so your keys are not uploaded. Check with `git status` before pushing.)

## Step 2: Supabase (database, sign-in, file storage)

1. Create a project at supabase.com. Choose the region closest to Render's (e.g. **US West** for Render's Oregon).
2. **SQL Editor → New query**: paste all of `packages/db/migrations/0001_init.sql` and click **Run**. It creates the tables,
   security rules, daily-limit function, the three private storage buckets and realtime.
3. **Project Settings → API**: copy the **Project URL**, the **anon public** key and the **service_role** key
   (the service_role key is secret: it goes only into Render, never into the browser or git).
4. **Authentication → URL Configuration**:
   - Site URL: `https://inkcut-web.onrender.com` (your Render URL; you can update it after Step 3)
   - Redirect URLs: add `https://inkcut-web.onrender.com/auth/callback` and `http://localhost:3000/auth/callback`
5. **Authentication → Providers**: Email is on by default (magic links). For **Google**: create an OAuth client in
   Google Cloud Console (APIs & Services → Credentials → OAuth client ID → Web application), add the redirect URI
   Supabase shows on the Google provider page, then paste the Client ID and Secret into Supabase.

## Step 3: Render Blueprint (web + worker + queue)

1. render.com → **New → Blueprint** → connect GitHub → choose `softalpha0/Inkcut`. Render reads `render.yaml`.
2. It asks for the secret values (`sync: false`):

| Variable                        | Service      | Value                                                            |
| ------------------------------- | ------------ | ---------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | web          | Supabase Project URL                                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web          | Supabase anon key                                                |
| `SUPABASE_SERVICE_ROLE_KEY`     | web + worker | Supabase service_role key                                        |
| `NEXT_PUBLIC_SITE_URL`          | web          | `https://inkcut-web.onrender.com`                                |
| `ADMIN_EMAILS`                  | web          | your email (lets only you use paid animation)                    |
| `SUPABASE_URL`                  | worker       | Supabase Project URL                                             |
| `SERV_API_KEY`                  | worker       | your SERV key                                                    |
| `POLLINATIONS_API_KEY`          | worker       | your `sk_` key (image + video permission, with a budget)         |
| `STT_API_KEY`                   | worker       | OpenAI key for voiceover uploads (leave empty to skip that mode) |

3. Click **Apply**. The first deploy takes a few minutes (the worker image installs FFmpeg).
4. Open `https://inkcut-web.onrender.com`, sign in, and make a 1-minute video.

### Good to know

- **Free web plan sleeps** after ~15 minutes without visitors; the first visit after that takes about a minute.
  The worker never sleeps, so videos keep processing.
- **Costs per video** come from SERV (script and planning) and Pollinations (about 0.02 pollen of images per minute).
  Animation (`ADMIN_EMAILS` only) is about 1 pollen per animated minute.
- **Limits** (spec §8, `packages/shared/src/limits.ts`): 3 videos and 30 redraws per user per day, 5 minutes max,
  6,000-character scripts, 25 MB / 5-minute voiceovers, one running video per user, files deleted after 48 hours.
- **Logs**: Render dashboard → service → Logs. Every worker line includes the project ID.

## Run the website locally (optional)

Needs the Supabase project from Step 2 and a Redis URL (for example the Render Key Value's external URL, or Upstash).
Put the Part 2 variables in `.env` (see `.env.example`), then in two terminals:

```powershell
pnpm dev:web     # http://localhost:3000
pnpm worker      # processes videos
```

## Development

```powershell
pnpm typecheck
pnpm lint
pnpm test        # pipeline, worker, web and render tests; no paid APIs
pnpm format
```

Optional integration tests run when these are set: `INKCUT_TEST_REDIS=redis://127.0.0.1:6379` (real BullMQ round trip)
and `INKCUT_TEST_PG="-h <socket dir> -p <port> -U postgres"` (applies the migration to a scratch Postgres and checks RLS).
