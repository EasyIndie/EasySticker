import { nanoid } from "nanoid";
import { type PublishJob, type PublishStatus } from "./types";

const jobs = new Map<string, PublishJob>();

export function createJob(provider: string): PublishJob {
  const job: PublishJob = {
    jobId: nanoid(),
    provider,
    createdAt: new Date().toISOString(),
    status: "queued"
  };
  jobs.set(job.jobId, job);
  return job;
}

export function getJob(jobId: string): PublishJob | null {
  return jobs.get(jobId) ?? null;
}

export function updateJob(jobId: string, patch: Partial<PublishJob>) {
  const job = jobs.get(jobId);
  if (!job) return;
  jobs.set(jobId, { ...job, ...patch });
}

export function setJobStatus(jobId: string, status: PublishStatus) {
  updateJob(jobId, { status });
}

