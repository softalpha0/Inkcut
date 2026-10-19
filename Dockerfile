# Inkcut website (Next.js). Render uses this when the web service is a Docker service.
# The video worker has its own Dockerfile in apps/worker/.
FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# NEXT_PUBLIC_* values are built into the browser code, so they are needed at build time.
# Render passes the service's environment variables as build arguments.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

COPY . .
RUN pnpm install --frozen-lockfile --prod=false --filter "@inkcut/web..." \
  && pnpm --filter @inkcut/web build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@inkcut/web", "start"]
