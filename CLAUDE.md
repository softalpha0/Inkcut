# CLAUDE.md — Inkcut

Read `docs/PRODUCT_SPEC.md` before any work. It is the source of truth for scope, architecture, schemas, limits and milestones.

## Environment
- Developer machine: **Windows + PowerShell**, editor VS Code.
- Use PowerShell-compatible commands. No `rm -rf`, `export`, `&&`-only chains or bash-only syntax in instructions given to the developer; scripts in `package.json` must run on Windows and Linux (use `cross-env`, `rimraf` where needed).
- Node 20+, pnpm workspaces, TypeScript strict mode.
- FFmpeg locally through `ffmpeg-static` / `ffprobe-static`; never assume FFmpeg is on PATH.
- Paths: always use `path.join` / `path.resolve`; never hardcode `/` separators.

## How to work
1. Work **one milestone at a time** (M1 → M4). Do not start the next milestone until the current one meets its acceptance criteria and the developer confirms.
2. Start each milestone by writing a short plan (files to create, order, risks) and wait for approval.
3. Before using any third-party API or package (SERV, fal.ai, Replicate, Edge TTS, Whisper, BullMQ, Supabase), check its current docs. Do not guess model names or method signatures.
4. Write **complete files**, not partial snippets.
5. After each meaningful step: run `pnpm typecheck`, `pnpm lint`, `pnpm test`. Fix failures before moving on.
6. Commit in small, clear commits (`feat(pipeline): add scene planner`).

## Code rules
- All LLM output is parsed and validated with zod schemas from `packages/shared`. On failure, retry with the validation error included (max 2 retries).
- External services sit behind provider interfaces (`ImageProvider`, `TtsProvider`, `SttProvider`, `LlmClient`) selected by env var.
- Every pipeline stage is idempotent: check for existing output before calling a paid service.
- Timeouts + retry with exponential backoff on every network call.
- Tests mock all external providers; no test may hit a paid API.
- Limits come only from `packages/shared/src/limits.ts`.

## Security
- Never commit `.env` or keys. Keep `.env.example` updated whenever a new variable is added.
- Service role key is used only in the worker and server routes, never in client components.
- Supabase RLS enabled on every user table.

## Ask the developer before
- Adding any paid service or changing a provider default.
- Changing the database schema beyond the spec.
- Deleting files or rewriting large parts of working code.
- Changing scope (anything in "Out of scope" in the spec).
