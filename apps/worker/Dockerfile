# Inkcut worker: BullMQ consumer that runs the video pipeline with system FFmpeg.
# Build from the repository root:  docker build -f apps/worker/Dockerfile .
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fontconfig ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/pipeline/package.json packages/pipeline/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @inkcut/worker...

COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/pipeline packages/pipeline
COPY apps/worker apps/worker

USER node
CMD ["pnpm", "--filter", "@inkcut/worker", "start"]
