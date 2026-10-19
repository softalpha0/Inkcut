import "server-only";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { JobDataSchema, QUEUE_NAME, jobIdFor, type JobData } from "@inkcut/shared";
import { serverEnv } from "./env";

let queue: Queue<JobData> | undefined;

function getQueue(): Queue<JobData> {
  queue ??= new Queue<JobData>(QUEUE_NAME, {
    connection: new Redis(serverEnv.redisUrl(), { maxRetriesPerRequest: null, enableReadyCheck: false }),
  });
  return queue;
}

/** Adds a job for the worker. Each job runs once; failures are recorded on the project. */
export async function enqueue(data: JobData): Promise<void> {
  const job = JobDataSchema.parse(data);
  await getQueue().add(job.type, job, {
    jobId: jobIdFor(job),
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 200,
  });
}
