import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { createServiceClient } from "@inkcut/db";
import { createLogger, errorMessage, loadEnv, providersFromEnv } from "@inkcut/pipeline";
import { JobDataSchema, QUEUE_NAME, type JobData } from "@inkcut/shared";
import { handleJob } from "./jobs.js";
import { SupabaseAssetStore, SupabaseProjectStore } from "./supabase-stores.js";

function env(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  throw new Error(`Missing environment variable ${name}`);
}

/** BullMQ needs maxRetriesPerRequest: null on its blocking connection. */
export function redisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

async function main(): Promise<void> {
  loadEnv();
  const log = createLogger({ service: "worker" });
  const db = createServiceClient(
    env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
  );
  const deps = {
    projects: new SupabaseProjectStore(db),
    assets: new SupabaseAssetStore(db),
    providers: providersFromEnv,
    log,
  };
  const redisUrl = env("REDIS_URL");
  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 1) || 1;

  const worker = new Worker<JobData>(
    QUEUE_NAME,
    async (job) => {
      const data = JobDataSchema.parse(job.data);
      await handleJob(data, deps);
    },
    { connection: redisConnection(redisUrl), concurrency, lockDuration: 5 * 60_000 },
  );
  worker.on("failed", (job, err) => log.warn("job failed", { id: job?.id, error: errorMessage(err) }));
  worker.on("error", (err) => log.error("worker error", { error: errorMessage(err) }));

  // Hourly cleanup of expired outputs (spec §8: 48 h retention).
  const queue = new Queue<JobData>(QUEUE_NAME, { connection: redisConnection(redisUrl) });
  await queue.upsertJobScheduler(
    "cleanup",
    { every: 60 * 60_000 },
    { name: "cleanup", data: { type: "cleanup" }, opts: { removeOnComplete: 10, removeOnFail: 50 } },
  );

  log.info("worker ready", { queue: QUEUE_NAME, concurrency });
  const stop = async () => {
    log.info("shutting down");
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
