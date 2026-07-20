"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { JobStatus } from "@metamagic/shared";
import { api } from "@/lib/api";

/** Polls a background job and renders its live, auto-following transcript. */
export function JobLog({
  jobId,
  onFinished,
  doneLabel = "Finished",
}: {
  jobId: string;
  onFinished?: () => void;
  doneLabel?: string;
}) {
  const { data: job } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<JobStatus<unknown>>(`/api/jobs/${jobId}`),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
  });

  const finished = job?.status === "done" || job?.status === "error";
  React.useEffect(() => {
    if (finished) onFinished?.();
  }, [finished, onFinished]);

  const logRef = React.useRef<HTMLDivElement>(null);
  const logLength = job?.log?.length ?? 0;
  React.useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [logLength]);

  if (!job) return null;

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-secondary/30 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        {job.status === "running" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {job.current ?? "Working…"}
          </>
        ) : job.status === "error" ? (
          <>
            <XCircle className="h-4 w-4 text-destructive" /> {job.error}
          </>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4 text-success" /> {doneLabel}
          </>
        )}
      </p>
      {job.log.length > 0 && (
        <div
          ref={logRef}
          className="max-h-56 overflow-y-auto rounded-md bg-background/60 p-2 font-mono text-xs leading-relaxed"
        >
          {job.log.map((line, i) => (
            <p
              key={i}
              className={
                line.startsWith("✗")
                  ? "text-destructive"
                  : line.startsWith("✓")
                    ? "text-success"
                    : "text-muted-foreground"
              }
            >
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
