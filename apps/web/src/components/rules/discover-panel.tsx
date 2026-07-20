"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Sparkles, Wand2 } from "lucide-react";
import type { DiscoveredCollection, JobStatus, RuleInput } from "@metamagic/shared";
import { api } from "@/lib/api";
import { imageUrl } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RuleDialog } from "./rule-dialog";

/** "Collections you could create" — scans the library for TMDb franchises. */
export function DiscoverPanel() {
  const qc = useQueryClient();
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [ruleInitial, setRuleInitial] = React.useState<Partial<RuleInput> | undefined>();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const scan = useMutation({
    mutationFn: () => api<{ jobId: string }>("/api/discover/collections", { method: "POST" }),
    onSuccess: (data) => setJobId(data.jobId),
  });

  const { data: job } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<JobStatus<DiscoveredCollection>>(`/api/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
  });

  const create = useMutation({
    mutationFn: (d: DiscoveredCollection) =>
      api("/api/discover/create", {
        method: "POST",
        body: JSON.stringify({
          sectionId: d.sectionId,
          title: d.name,
          ratingKeys: d.owned.map((o) => o.ratingKey),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const running = job?.status === "running";
  const suggestions = job?.results ?? [];
  const createdKeys = new Set(
    create.isSuccess && create.variables ? [create.variables.tmdbCollectionId] : [],
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Collections you could create
          </CardTitle>
          <CardDescription>
            Scans your movie libraries and finds franchises where you own two or more films but have
            no Plex collection yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Button loading={scan.isPending || running} onClick={() => scan.mutate()}>
              {running ? "Scanning…" : "Scan my library"}
            </Button>
            {running && job?.current && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {job.current}
              </span>
            )}
            {job?.status === "error" && (
              <span className="text-sm text-destructive">{job.error}</span>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="space-y-2">
              {suggestions.map((d) => (
                <div
                  key={d.tmdbCollectionId}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-secondary/20 p-2.5"
                >
                  <div className="flex -space-x-3">
                    {d.owned.slice(0, 4).map((o) =>
                      o.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={o.ratingKey}
                          src={imageUrl(o.thumb, 60, 90)}
                          alt=""
                          loading="lazy"
                          className="h-14 w-9 rounded border border-background object-cover"
                        />
                      ) : (
                        <span
                          key={o.ratingKey}
                          className="h-14 w-9 rounded border border-background bg-secondary"
                        />
                      ),
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.owned.length} in your library
                    </p>
                  </div>
                  {createdKeys.has(d.tmdbCollectionId) ? (
                    <Badge variant="success">created</Badge>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={create.isPending && create.variables?.tmdbCollectionId === d.tmdbCollectionId}
                        onClick={() => create.mutate(d)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Create
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Create a rule that keeps it in sync"
                        onClick={() => {
                          setRuleInitial({
                            name: d.name,
                            collectionTitle: d.name,
                            sectionId: d.sectionId,
                            source: {
                              kind: "tmdb-collection",
                              tmdbCollectionId: d.tmdbCollectionId,
                              tmdbCollectionName: d.name,
                            },
                            schedule: "daily",
                          });
                          setDialogOpen(true);
                        }}
                      >
                        <Wand2 className="h-3.5 w-3.5" /> Automate
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {job?.status === "done" && suggestions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing new to suggest — every franchise you own already has a collection.
            </p>
          )}
        </CardContent>
      </Card>

      <RuleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} initial={ruleInitial} />
    </>
  );
}
