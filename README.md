# Inkcut

Turn a topic, a script or your own voiceover into a narrated cartoon explainer video (MP4): stickman, flat cartoon, whiteboard, storybook and more, or a style you describe.
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

# Other looks: --style flat-cartoon | whiteboard | storybook | comic | chalkboard | paper-cutout
# or describe your own (no studio or show names):
pnpm cli --topic "How compound interest works" --custom-style "1950s retro cartoon, muted colours"

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

# Part 2: Deploy the website on Render (free)

The **website** and the **job queue** run on Render's free plans; **Supabase** (database, sign-in, files) is free too.
The **video worker runs on your own PC** (`pnpm worker`): it picks up videos people start on the website.
Videos are only made while your PC is on and the worker is running; jobs simply wait in the queue until then.
When you want it running 24/7, move the worker to Render (Starter plan, about $7/month; see the end of `render.yaml`).

## Step 1: Put the code on GitHub

Render deploys from a GitHub repository. From `C:\dev\Inkcut` in PowerShell (one time):

```powershell
git init
git add -A
git status          # .env and out\ must NOT be listed
git commit -m "Inkcut"
git branch -M main
git remote add origin https://github.com/softalpha0/Inkcut.git
git push -u origin main
```

## Step 2: Supabase (database, sign-in, file storage)

1. Create a project at supabase.com (pick a region close to Render's Oregon, e.g. **US West**).
2. **SQL Editor**: paste the _contents_ of `packages/db/migrations/0001_init.sql`
   (`Get-Content packages\db\migrations\0001_init.sql -Raw | Set-Clipboard`) and click **Run**.
   Then do the same with `packages/db/migrations/0002_custom_style.sql` (adds custom art styles).
3. **Project Settings → API**: copy the **Project URL**, the **anon** key and the **service_role** key (secret).
4. **Authentication → URL Configuration** (after Step 3, when you know your Render address):
   - Site URL: `https://inkcut-web.onrender.com`
   - Redirect URLs: `https://inkcut-web.onrender.com/**` and `http://localhost:3000/**`
   - **Authentication → Emails → Templates**: in both **Magic Link** and **Confirm signup**, change the
     link to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email` so sign-in links
     work even when opened on a different device than the one that asked for them.
   - The built-in email sender only sends 2 emails an hour. For real users add custom SMTP
     (**Authentication → Emails → SMTP Settings**, e.g. Gmail with an app password).
5. **Authentication → Providers**: email links work out of the box. Google is optional (needs a Google Cloud OAuth client).

## Step 3: Render Blueprint (website + queue)

1. render.com → **New → Blueprint** → connect GitHub → choose `softalpha0/Inkcut`. Both services are on free plans.
2. Fill in the values it asks for:

| Variable                        | Value                                        |
| ------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase Project URL                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key                            |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase service_role key                    |
| `NEXT_PUBLIC_SITE_URL`          | `https://inkcut-web.onrender.com`            |
| `ADMIN_EMAILS`                  | your email (only you can use paid animation) |

3. Click **Apply** and wait for the website to deploy (a few minutes).

## Step 4: Run the worker on your PC

1. Render dashboard → **inkcut-queue** → **Connect** → copy the **External** Redis URL (starts with `rediss://`).
2. Add these lines to `C:\dev\Inkcut\.env` (keep your existing SERV and Pollinations keys there):

```
SUPABASE_URL=<Supabase Project URL>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
REDIS_URL=<External Redis URL from Render>
IMAGE_PROVIDER=pollinations
```

3. Start it and leave the window open:

```powershell
cd C:\dev\Inkcut
pnpm worker
```

It prints `worker ready`. Now open your Render website, sign in, and make a video: the worker window shows it being made.

### Good to know

- **Free website sleeps** after ~15 minutes without visitors; the first visit after that takes about a minute.
- **Supabase free projects pause** after a week with no activity; un-pause from the Supabase dashboard.
- **Costs per video** come from SERV (script and planning) and Pollinations (about 0.02 pollen of images per minute).
  Animation (`ADMIN_EMAILS` only) is about 1 pollen per animated minute.
- **Limits** (`packages/shared/src/limits.ts`): 3 videos and 30 redraws per user per day, 5 minutes max, 6,000-character
  scripts, 25 MB / 5-minute voiceovers, one running video per user, files deleted after 48 hours (the worker's hourly
  cleanup runs while it is on).

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
