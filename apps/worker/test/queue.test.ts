import { spawnSync } from "node:child_process";
import { Queue, QueueEvents, Worker } from "bullmq";
import { describe, expect, it } from "vitest";
import { JobDataSchema, QUEUE_NAME, type JobData } from "@inkcut/shared";
import { redisConnectionForTests } from "./redis.js";

/** End-to-end through a real Redis when INKCUT_TEST_REDIS is set (e.g. redis://127.0.0.1:6390). */
const url = process.env.INKCUT_TEST_REDIS;

describe.skipIf(!url || spawnSync("redis-cli", ["-u", url ?? "", "ping"]).status !== 0)(
  "BullMQ queue",
  () => {
    it("delivers validated jobs from the web producer to the worker", async () => {
      const name = `${QUEUE_NAME}-test-${Date.now()}`;
      const queue = new Queue<JobData>(name, { connection: redisConnectionForTests(url!) });
      const events = new QueueEvents(name, { connection: redisConnectionForTests(url!) });
      const seen: JobData[] = [];
      const worker = new Worker<JobData>(
        name,
        async (job) => {
          seen.push(JobDataSchema.parse(job.data));
        },
        { connection: redisConnectionForTests(url!) },
      );
      const job = await queue.add("render", {
        type: "render",
        projectId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      });
      await job.waitUntilFinished(events, 10_000);
      expect(seen).toEqual([{ type: "render", projectId: "7c9e6679-7425-40de-944b-e07fc1f90ae7" }]);
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
    });
  },
);
