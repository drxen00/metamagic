"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity as ActivityIcon,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Hand,
  Minus,
  Plus,
  X,
  XCircle,
} from "lucide-react";
import type { RuleRun } from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Topbar } from "@/components/shell/topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { JobLog } from "@/components/rules/job-log";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString();
}

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "success" | "destructive" }> = {
  applied: { label: "applied", variant: "success" },
  pending: { label: "needs approval", variant: "default" },
  "no-changes": { label: "no changes", variant: "outline" },
  error: { label: "failed", variant: "destructive" },
  dismissed: { label: "dismissed", variant: "outline" },
};

export default function ActivityPage() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const [applyJobId, setApplyJobId] = React.useState<string | null>(null);

  const { data: runs, isLoading } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api<RuleRun[]>("/api/runs"),
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["runs"] });
    qc.invalidateQueries({ queryKey: ["rules"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
  };

  const applyRun = useMutation({
    mutationFn: (run: RuleRun) =>
      api<{ jobId: string }>(`/api/runs/${run.id}/apply`, { method: "POST" }),
    onSuccess: (data) => setApplyJobId(data.jobId),
  });

  const dismissRun = useMutation({
    mutationFn: (run: RuleRun) => api(`/api/runs/${run.id}/dismiss`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const pending = runs?.filter((r) => r.status === "pending") ?? [];

  return (
    <main>
      <Topbar title="Activity" />
      <div className="space-y-4 p-6">
        {pending.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {pending.length} run{pending.length === 1 ? "" : "s"} waiting for your approval.
          </p>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : !runs || runs.length === 0 ? (
          <EmptyState
            icon={ActivityIcon}
            title="Nothing has run yet"
            description="Once your rules run — manually or on a schedule — every change lands here with its full log."
          />
        ) : (
          <div className="space-y-3">
            {runs.map((run) => {
              const status = STATUS[run.status] ?? STATUS.applied;
              const isOpen = expanded === run.id;
              return (
                <Card
                  key={run.id}
                  className={cn(run.status === "pending" && "border-primary/40")}
                >
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => setExpanded(isOpen ? null : run.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{run.ruleName}</span>
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {run.trigger === "schedule" ? (
                              <>
                                <CalendarClock className="h-3 w-3" /> scheduled
                              </>
                            ) : (
                              <>
                                <Hand className="h-3 w-3" /> manual
                              </>
                            )}
                            <span aria-hidden>·</span>
                            {relativeTime(run.startedAt)}
                            {(run.addedCount > 0 || run.removedCount > 0) && (
                              <>
                                <span aria-hidden>·</span>
                                {run.addedCount > 0 && <span className="text-success">+{run.addedCount}</span>}
                                {run.removedCount > 0 && (
                                  <span className="text-destructive">−{run.removedCount}</span>
                                )}
                              </>
                            )}
                            {run.error && (
                              <>
                                <span aria-hidden>·</span>
                                <span className="truncate text-destructive">{run.error}</span>
                              </>
                            )}
                          </span>
                        </span>
                      </button>

                      {run.status === "pending" && (
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            loading={applyRun.isPending && applyRun.variables?.id === run.id}
                            onClick={() => applyRun.mutate(run)}
                          >
                            <Check className="h-3.5 w-3.5" /> Apply
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={dismissRun.isPending && dismissRun.variables?.id === run.id}
                            onClick={() => dismissRun.mutate(run)}
                          >
                            <X className="h-3.5 w-3.5" /> Dismiss
                          </Button>
                        </div>
                      )}
                    </div>

                    {isOpen && (
                      <div className="mt-3 space-y-3 pl-6">
                        {run.pending && (
                          <div className="space-y-1 text-sm">
                            {run.pending.toAdd.map((c) => (
                              <p key={`a-${c.ratingKey}`} className="flex items-center gap-1.5 text-success">
                                <Plus className="h-3.5 w-3.5 shrink-0" /> {c.title}
                                {c.year ? ` (${c.year})` : ""}
                              </p>
                            ))}
                            {run.pending.toRemove.map((c) => (
                              <p
                                key={`r-${c.ratingKey}`}
                                className="flex items-center gap-1.5 text-destructive"
                              >
                                <Minus className="h-3.5 w-3.5 shrink-0" /> {c.title}
                                {c.year ? ` (${c.year})` : ""}
                              </p>
                            ))}
                          </div>
                        )}
                        {run.log.length > 0 ? (
                          <div className="max-h-64 overflow-y-auto rounded-md bg-background/60 p-2 font-mono text-xs leading-relaxed">
                            {run.log.map((line, i) => (
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
                        ) : (
                          <p className="text-xs text-muted-foreground">No log for this run.</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={!!applyJobId}
        onClose={() => {
          setApplyJobId(null);
          invalidate();
        }}
        title="Applying changes"
        className="max-w-2xl"
      >
        {applyJobId && <JobLog jobId={applyJobId} onFinished={invalidate} doneLabel="Changes applied" />}
        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setApplyJobId(null);
              invalidate();
            }}
          >
            Close
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
