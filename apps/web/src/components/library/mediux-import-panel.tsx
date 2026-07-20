"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { JobStatus, MediuxMatch } from "@metamagic/shared";
import { api } from "@/lib/api";
import { imageUrl } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Paste-YAML → preview → apply flow with live job transcript. */
export function MediuxImportPanel({ rows = 6 }: { rows?: number }) {
  const qc = useQueryClient();
  const [yamlText, setYamlText] = React.useState("");
  const [previewResults, setPreviewResults] = React.useState<MediuxMatch[] | null>(null);
  const [mode, setMode] = React.useState<"preview" | "apply" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);

  const preview = useMutation({
    mutationFn: () =>
      api<MediuxMatch[]>("/api/mediux/preview", {
        method: "POST",
        body: JSON.stringify({ yaml: yamlText }),
      }),
    onSuccess: (data) => {
      setPreviewResults(data);
      setMode("preview");
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
  });

  const applyStart = useMutation({
    mutationFn: () =>
      api<{ jobId: string }>("/api/mediux/apply", {
        method: "POST",
        body: JSON.stringify({ yaml: yamlText }),
      }),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setMode("apply");
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
  });

  const { data: job } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<JobStatus<MediuxMatch>>(`/api/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1200 : false),
  });

  const jobRunning = job?.status === "running";
  const jobFinished = job?.status === "done" || job?.status === "error";
  React.useEffect(() => {
    if (jobFinished) {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["item"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["collection-children"] });
      qc.invalidateQueries({ queryKey: ["provenance"] });
      qc.invalidateQueries({ queryKey: ["children"] });
      qc.invalidateQueries({ queryKey: ["artwork"] });
    }
  }, [jobFinished, qc]);

  const results = mode === "apply" ? (job?.results ?? []) : previewResults;
  const matched = results?.filter((r) => r.ratingKey).length ?? 0;
  const applied = results?.filter((r) => r.applied).length ?? 0;

  const logRef = React.useRef<HTMLDivElement>(null);
  const logLength = job?.log?.length ?? 0;
  React.useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    // Follow the tail unless the user scrolled up to inspect earlier lines
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [logLength]);

  return (
    <div className="space-y-4">
      <textarea
        value={yamlText}
        onChange={(e) => {
          setYamlText(e.target.value);
          setPreviewResults(null);
          setMode(null);
          setJobId(null);
        }}
        rows={rows}
        placeholder={"metadata:\n  \"603692\":\n    url_poster: https://api.mediux.pro/assets/…"}
        className="w-full rounded-md border border-input bg-background/50 px-3 py-2 font-mono text-xs leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {error && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <XCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {results && (mode === "preview" || job) && (
        <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            {mode === "apply" ? (
              jobRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {job?.current ?? "Working…"}
                </>
              ) : job?.status === "error" ? (
                <>
                  <XCircle className="h-4 w-4 text-destructive" /> {job.error}
                </>
              ) : (
                `Applied ${applied} of ${results.length} entries`
              )
            ) : (
              `${matched} of ${results.length} entries match your libraries`
            )}
          </p>

          {mode === "apply" && job && job.log.length > 0 && (
            <div
              ref={logRef}
              className="max-h-44 overflow-y-auto rounded-md bg-background/60 p-2 font-mono text-xs leading-relaxed"
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

          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {results.map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 text-sm">
                {r.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={/^https?:\/\//.test(r.thumb) ? r.thumb : imageUrl(r.thumb, 40, 60)}
                    alt=""
                    className="h-9 w-6 rounded object-cover"
                  />
                ) : (
                  <span className="h-9 w-6 rounded bg-secondary" />
                )}
                <span className="flex-1 truncate">
                  {r.title ?? `id ${r.id}`}
                  {!r.ratingKey && r.kind === "item" && r.title && (
                    <span className="ml-1.5 text-xs text-muted-foreground">(not downloaded)</span>
                  )}
                  {r.kind === "collection" && (
                    <Badge variant="outline" className="ml-1.5">
                      collection
                    </Badge>
                  )}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {[
                      r.hasPoster && "poster",
                      r.hasBackground && "background",
                      r.seasonCount > 0 &&
                        `${mode === "apply" ? `${r.appliedSeasons ?? 0}/` : ""}${r.seasonCount} season${r.seasonCount === 1 ? "" : "s"}`,
                      r.episodeCount > 0 &&
                        `${mode === "apply" ? `${r.appliedEpisodes ?? 0}/` : ""}${r.episodeCount} card${r.episodeCount === 1 ? "" : "s"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {mode === "apply" ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    {r.applied && <CheckCircle2 className="h-4 w-4 text-success" />}
                    {r.error && (
                      <span className="max-w-48 truncate text-xs text-destructive" title={r.error}>
                        {r.error}
                      </span>
                    )}
                  </span>
                ) : r.ratingKey ? (
                  <Badge variant="success">match</Badge>
                ) : (
                  <Badge variant="outline">
                    {r.kind === "collection" ? "no matching collection" : "not in library"}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="rounded-md border border-border/60 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
        <strong className="font-medium text-foreground/80">Collection posters:</strong> MediUX set
        YAML almost never includes the collection’s own poster — only the movies’. To set it, open
        the collection, hit Change poster, and paste the collection image link from MediUX in the
        URL / Upload tab.
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          loading={preview.isPending}
          disabled={!yamlText.trim() || preview.isPending || jobRunning}
          onClick={() => preview.mutate()}
        >
          Preview matches
        </Button>
        <Button
          loading={applyStart.isPending || jobRunning}
          disabled={
            !yamlText.trim() ||
            applyStart.isPending ||
            jobRunning ||
            (mode === "preview" && matched === 0)
          }
          onClick={() => applyStart.mutate()}
        >
          Apply to library
        </Button>
      </div>
    </div>
  );
}
