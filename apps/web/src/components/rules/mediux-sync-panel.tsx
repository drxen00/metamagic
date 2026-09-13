"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Play, Pause, RotateCw, Settings, Sparkles, Trash2, Tv } from "lucide-react";
import type { MediuxSyncMode, MediuxSyncState } from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Label, NativeSelect } from "@/components/ui/input";
import { JobLog } from "./job-log";

function whenLabel(ts?: number): string {
  if (!ts) return "not yet synced";
  return `last synced ${new Date(ts).toLocaleString()}`;
}

function relTime(ts?: number): string {
  if (!ts) return "never";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : new Date(ts).toLocaleDateString();
}

const MODE_LABEL: Record<MediuxSyncMode, string> = {
  detect: "On detection (recommended)",
  hourly: "On a schedule — hourly",
  daily: "On a schedule — daily",
  weekly: "On a schedule — weekly",
};

/**
 * "MediUX Auto-Sync" — the predefined, no-YAML-wrangling automation. A global
 * toggle keeps every collection/show you've styled with a MediUX set up to date;
 * each item can be flipped off individually.
 */
export function MediuxSyncPanel() {
  const qc = useQueryClient();
  const [runJobId, setRunJobId] = React.useState<string | null>(null);
  const [runningTitle, setRunningTitle] = React.useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["mediux-sync"],
    queryFn: () => api<MediuxSyncState>("/api/mediux/sync"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["mediux-sync"] });

  const setGlobal = useMutation({
    mutationFn: (enabled: boolean) =>
      api("/api/mediux/sync", { method: "PUT", body: JSON.stringify({ enabled }) }),
    onSuccess: invalidate,
  });

  const setMode = useMutation({
    mutationFn: (mode: MediuxSyncMode) =>
      api("/api/mediux/sync", { method: "PUT", body: JSON.stringify({ mode }) }),
    onSuccess: invalidate,
  });

  const [showSettings, setShowSettings] = React.useState(false);

  const setWatch = useMutation({
    mutationFn: (v: { ratingKey: string; enabled: boolean }) =>
      api(`/api/mediux/watches/${v.ratingKey}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: v.enabled }),
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (ratingKey: string) =>
      api(`/api/mediux/watches/${ratingKey}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const runNow = useMutation({
    mutationFn: (ratingKey: string) =>
      api<{ jobId: string }>(`/api/mediux/watches/${ratingKey}/run`, { method: "POST" }),
    onSuccess: (res, ratingKey) => {
      setRunJobId(res.jobId);
      setRunningTitle(data?.watches.find((w) => w.ratingKey === ratingKey)?.title ?? "item");
    },
  });

  const onRunFinished = React.useCallback(() => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["items"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);

  const enabled = data?.enabled ?? false;
  const mode: MediuxSyncMode = data?.mode ?? "detect";
  const watches = data?.watches ?? [];

  const statusLine = !enabled
    ? "Auto-sync is off — your remembered sets won't change on their own."
    : mode === "detect"
      ? `Auto-detecting — checks about every 15 minutes and acts only when a collection or show changes. Last checked ${relTime(data?.lastCheckedAt)}.`
      : `Re-applying on a ${mode} schedule. Last checked ${relTime(data?.lastCheckedAt)}.`;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> MediUX Auto-Sync
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                When you apply a MediUX set to a collection or show, MetaMagic remembers it. Turn this
                on and it keeps those items in sync automatically — new franchise movies get added to
                the collection and re-styled, and new seasons get their MediUX artwork — no YAML,
                no rules to build.
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant={enabled ? "default" : "outline"}
                loading={setGlobal.isPending}
                onClick={() => setGlobal.mutate(!enabled)}
              >
                {enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {enabled ? "Auto-sync on" : "Auto-sync off"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Sync settings"
                aria-label="Sync settings"
                onClick={() => setShowSettings((s) => !s)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className={cn("inline-flex h-2 w-2 shrink-0 rounded-full", enabled ? "animate-pulse bg-success" : "bg-muted-foreground/40")} />
            <span className="text-muted-foreground">{statusLine}</span>
          </div>

          {showSettings && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-secondary/20 p-3">
              <div className="space-y-1">
                <Label className="text-xs">How it runs</Label>
                <NativeSelect
                  value={mode}
                  disabled={setMode.isPending}
                  onChange={(e) => setMode.mutate(e.target.value as MediuxSyncMode)}
                >
                  {(Object.keys(MODE_LABEL) as MediuxSyncMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <p className="max-w-md text-xs text-muted-foreground">
                <strong>On detection</strong> reacts when Plex gains a movie or season. A{" "}
                <strong>schedule</strong> re-applies your sets at a fixed interval whether or not
                anything changed.
              </p>
            </div>
          )}

          {watches.length === 0 ? (
            <p className="rounded-md border border-border/60 bg-secondary/20 p-3 text-sm text-muted-foreground">
              Nothing here yet. Open a collection or show, hit <strong>Change poster</strong> → the{" "}
              <strong>MediUX YAML</strong> tab, and apply a set — it&apos;ll appear here, ready to keep
              in sync.
            </p>
          ) : (
            <div className="space-y-1.5">
              {watches.map((w) => (
                <div
                  key={w.ratingKey}
                  className={cn(
                    "flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-secondary/20 p-2.5",
                    (!w.enabled || !enabled) && "opacity-60",
                  )}
                >
                  {w.type === "show" ? (
                    <Tv className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{w.title}</p>
                      <Badge variant="outline">{w.type}</Badge>
                      {!w.enabled && <Badge variant="secondary">skipped</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {whenLabel(w.lastSyncedAt)}
                      {w.lastResult ? ` · ${w.lastResult}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={runNow.isPending && runNow.variables === w.ratingKey}
                      onClick={() => runNow.mutate(w.ratingKey)}
                    >
                      <RotateCw className="h-3.5 w-3.5" /> Run now
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={w.enabled ? "Skip this item" : "Include this item"}
                      onClick={() => setWatch.mutate({ ratingKey: w.ratingKey, enabled: !w.enabled })}
                    >
                      {w.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Forget this set"
                      onClick={() => remove.mutate(w.ratingKey)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!runJobId}
        onClose={() => setRunJobId(null)}
        title={`Syncing ${runningTitle ?? "item"}`}
        className="max-w-2xl"
      >
        {runJobId && <JobLog jobId={runJobId} onFinished={onRunFinished} doneLabel="Sync finished" />}
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={() => setRunJobId(null)}>
            Close
          </Button>
        </div>
      </Dialog>
    </>
  );
}
