"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pause, Pencil, Play, Plus, Tag, Trash2, Wand2 } from "lucide-react";
import type { AutomationSettings, Rule } from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Topbar } from "@/components/shell/topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { RuleDialog } from "@/components/rules/rule-dialog";
import { JobLog } from "@/components/rules/job-log";

const SCHEDULE_LABEL: Record<string, string> = {
  manual: "Manual only",
  hourly: "Every hour",
  daily: "Daily",
  weekly: "Weekly",
};

export default function RulesPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Rule | undefined>();
  const [confirmDelete, setConfirmDelete] = React.useState<Rule | null>(null);
  const [runJobId, setRunJobId] = React.useState<string | null>(null);
  const [runningRule, setRunningRule] = React.useState<string | null>(null);

  const { data: rules, isLoading } = useQuery({
    queryKey: ["rules"],
    queryFn: () => api<Rule[]>("/api/rules"),
  });

  const { data: automations } = useQuery({
    queryKey: ["automations"],
    queryFn: () => api<AutomationSettings>("/api/settings/automations"),
  });

  const toggleEnabled = useMutation({
    mutationFn: (rule: Rule) =>
      api(`/api/rules/${rule.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });

  const remove = useMutation({
    mutationFn: (rule: Rule) => api(`/api/rules/${rule.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      setConfirmDelete(null);
    },
  });

  const runNow = useMutation({
    mutationFn: (rule: Rule) =>
      api<{ jobId: string }>(`/api/rules/${rule.id}/run`, { method: "POST" }),
    onSuccess: (data, rule) => {
      setRunJobId(data.jobId);
      setRunningRule(rule.name);
    },
  });

  const onRunFinished = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["rules"] });
    qc.invalidateQueries({ queryKey: ["runs"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
  }, [qc]);

  return (
    <main>
      <Topbar
        title="Rules"
        actions={
          <Button
            size="sm"
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New rule
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        {automations?.paused && (
          <Card className="border-warning/40">
            <CardContent className="flex items-center gap-3 p-4 text-sm">
              <Pause className="h-4 w-4 text-warning" />
              Automations are paused — scheduled runs won’t fire. Resume them in Settings.
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : !rules || rules.length === 0 ? (
          <EmptyState
            icon={Wand2}
            title="No rules yet"
            description="A rule keeps a Plex collection in sync with a TMDb franchise or keyword — adding new arrivals automatically, on a schedule, and re-applying your MediUX artwork."
            action={
              <Button
                className="mt-2"
                onClick={() => {
                  setEditing(undefined);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Create your first rule
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <Card key={rule.id} className={cn(!rule.enabled && "opacity-60")}>
                <CardContent className="flex flex-wrap items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{rule.name}</p>
                      {!rule.enabled && <Badge variant="outline">disabled</Badge>}
                      {rule.requireApproval && <Badge variant="secondary">asks first</Badge>}
                      {rule.removeStrays && <Badge variant="outline">prunes strays</Badge>}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {rule.source.kind === "tmdb-keyword" ? (
                        <>
                          <Tag className="h-3 w-3" /> keyword “{rule.source.keywordName}”
                        </>
                      ) : (
                        <>franchise “{rule.source.tmdbCollectionName}”</>
                      )}
                      <span aria-hidden>→</span>
                      <span className="text-foreground/80">{rule.collectionTitle}</span>
                      <span aria-hidden>·</span>
                      <CalendarClock className="h-3 w-3" />
                      {SCHEDULE_LABEL[rule.schedule]}
                      {rule.lastResult && (
                        <>
                          <span aria-hidden>·</span>
                          <span>last run: {rule.lastResult}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={runNow.isPending && runNow.variables?.id === rule.id}
                      onClick={() => runNow.mutate(rule)}
                    >
                      <Play className="h-3.5 w-3.5" /> Run now
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleEnabled.mutate(rule)}
                      title={rule.enabled ? "Disable" : "Enable"}
                    >
                      {rule.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(rule);
                        setDialogOpen(true);
                      }}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete(rule)}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <RuleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} rule={editing} />

      <Dialog
        open={!!runJobId}
        onClose={() => setRunJobId(null)}
        title={`Running ${runningRule ?? "rule"}`}
        className="max-w-2xl"
      >
        {runJobId && <JobLog jobId={runJobId} onFinished={onRunFinished} doneLabel="Rule finished" />}
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={() => setRunJobId(null)}>
            Close
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete this rule?"
      >
        <p className="text-sm text-muted-foreground">
          “{confirmDelete?.name}” will stop running. The Plex collection it manages is left alone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={remove.isPending}
            onClick={() => confirmDelete && remove.mutate(confirmDelete)}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
