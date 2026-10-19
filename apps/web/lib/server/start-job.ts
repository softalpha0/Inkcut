import "server-only";
import type { JobData } from "@inkcut/shared";
import { fail } from "./http";
import { hasActiveJob, setStatus } from "./projects";
import { enqueue } from "./queue";

/** Marks the project queued and enqueues the job, enforcing one running job per user. */
export async function startJob(projectId: string, userId: string, job: JobData) {
  if (await hasActiveJob(userId)) {
    return fail(409, "You already have a video in progress. Wait for it to finish first.");
  }
  await setStatus(projectId, { status: "queued", current_stage: null, error: null });
  try {
    await enqueue(job);
  } catch (err) {
    await setStatus(projectId, { status: "failed", error: "Could not reach the job queue. Try again." });
    throw err;
  }
  return null;
}
