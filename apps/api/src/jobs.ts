import crypto from "node:crypto";
import type { JobStatus } from "@metamagic/shared";

const JOB_TTL_MS = 60 * 60 * 1000;

const jobs = new Map<string, JobStatus>();

export interface JobReporter<T> {
  setCurrent: (line: string) => void;
  push: (result: T) => void;
}

/** Run `runner` in the background; poll the returned job id for progress. */
export function startJob<T>(
  kind: string,
  runner: (report: JobReporter<T>) => Promise<void>,
): JobStatus<T> {
  for (const [id, job] of jobs) {
    if (Date.now() - Number(id.split(":")[0]) > JOB_TTL_MS) jobs.delete(id);
    else if (job.status !== "running" && jobs.size > 50) jobs.delete(id);
  }

  const id = `${Date.now()}:${crypto.randomBytes(8).toString("hex")}`;
  const job: JobStatus<T> = { id, kind, status: "running", results: [] };
  jobs.set(id, job as JobStatus);

  const report: JobReporter<T> = {
    setCurrent: (line) => {
      job.current = line;
    },
    push: (result) => {
      job.results.push(result);
    },
  };

  runner(report)
    .then(() => {
      job.status = "done";
      job.current = undefined;
    })
    .catch((err: unknown) => {
      job.status = "error";
      job.current = undefined;
      job.error = err instanceof Error ? err.message : "Job failed";
    });

  return job;
}

export function getJob(id: string): JobStatus | undefined {
  return jobs.get(id);
}
