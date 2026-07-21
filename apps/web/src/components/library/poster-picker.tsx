"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  ExternalLink,
  ImageIcon,
  Link2,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import type {
  ArtworkKind,
  ArtworkLinks,
  ArtworkOption,
  IntegrationsStatus,
  JobStatus,
  TpdbSetResult,
} from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MediuxImportPanel } from "./mediux-import-panel";

interface PosterPickerProps {
  open: boolean;
  onClose: () => void;
  ratingKey: string;
  itemTitle: string;
  kind: ArtworkKind;
  /** Plex item type ("movie" | "show" | "season" | "collection"…) */
  itemType?: string;
}

type Tab = "plex" | "tmdb" | "url" | "yaml";

const TPDB_SET_RE = /^https?:\/\/(?:www\.)?theposterdb\.com\/set\/\d+/i;

export function PosterPicker({
  open,
  onClose,
  ratingKey,
  itemTitle,
  kind,
  itemType,
}: PosterPickerProps) {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<Tab>("plex");
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [setJobId, setSetJobId] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const isCollection = itemType === "collection";
  const cleanUrl = url.trim();
  const isSetUrl = TPDB_SET_RE.test(cleanUrl);
  const isValidUrl = /^https?:\/\//i.test(cleanUrl);

  const { data: integrations } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<IntegrationsStatus>("/api/settings/integrations"),
    enabled: open,
  });

  const { data: links } = useQuery({
    queryKey: ["artwork-links", ratingKey],
    queryFn: () => api<ArtworkLinks>(`/api/items/${ratingKey}/links`),
    enabled: open,
  });

  const { data: options, isLoading, error: listError } = useQuery({
    queryKey: ["artwork", ratingKey, kind, tab],
    queryFn: () =>
      api<ArtworkOption[]>(`/api/items/${ratingKey}/artwork?kind=${kind}&source=${tab}`),
    enabled: open && tab !== "url",
    retry: false,
  });

  const { data: setJob } = useQuery({
    queryKey: ["job", setJobId],
    queryFn: () => api<JobStatus<TpdbSetResult>>(`/api/jobs/${setJobId}`),
    enabled: !!setJobId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1200 : false),
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["provenance"] });
    qc.invalidateQueries({ queryKey: ["artwork", ratingKey] });
    qc.invalidateQueries({ queryKey: ["children"] });
    qc.invalidateQueries({ queryKey: ["item", ratingKey] });
    qc.invalidateQueries({ queryKey: ["items"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["collection-children"] });
  }, [qc, ratingKey]);

  const jobFinished = setJob?.status === "done" || setJob?.status === "error";
  React.useEffect(() => {
    if (jobFinished) invalidate();
  }, [jobFinished, invalidate]);

  const apply = useMutation({
    mutationFn: (applyUrl: string) =>
      api(`/api/items/${ratingKey}/artwork`, {
        method: "POST",
        body: JSON.stringify({ kind, url: applyUrl }),
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (e) => setError((e as Error).message),
    onMutate: () => setError(null),
  });

  const applySet = useMutation({
    mutationFn: () =>
      api<{ jobId: string }>(`/api/collections/${ratingKey}/tpdb-set`, {
        method: "POST",
        body: JSON.stringify({ url: cleanUrl }),
      }),
    onSuccess: (data) => setSetJobId(data.jobId),
    onError: (e) => setError((e as Error).message),
    onMutate: () => setError(null),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const res = await fetch(`/api/items/${ratingKey}/artwork/upload?kind=${kind}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (e) => setError((e as Error).message),
    onMutate: () => setError(null),
  });

  const label = kind === "poster" ? "poster" : "background";
  const tpdbSearch =
    links?.tpdbUrl ?? `https://theposterdb.com/search?term=${encodeURIComponent(itemTitle)}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Change ${label} — ${itemTitle}`}
      className="w-[96vw] max-w-[1500px]"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: "plex", label: "Plex" },
              { id: "tmdb", label: "TMDb" },
              { id: "url", label: "URL / Upload" },
              { id: "yaml", label: "MediUX YAML" },
            ] as { id: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                tab === t.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-3">
            {links?.mediuxUrl && (
              <a
                href={links.mediuxUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
              >
                MediUX <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <a
              href={tpdbSearch}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
            >
              ThePosterDB <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </span>
        </div>

        {tab === "yaml" ? (
          <div className="mx-auto max-h-[74vh] w-full max-w-3xl overflow-y-auto px-1 py-2">
            <p className="mb-3 text-sm text-muted-foreground">
              Paste the “Copy YAML” block from a MediUX set page — it applies to everything it
              matches in your libraries (shows, seasons, episode cards, movies), not just this
              item.
            </p>
            <MediuxImportPanel rows={8} />
          </div>
        ) : tab !== "url" ? (
          <div className="max-h-[74vh] min-h-[40vh] overflow-y-auto pr-1">
            {isLoading ? (
              <div
                className={cn(
                  "grid gap-4",
                  kind === "poster"
                    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                    : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
                )}
              >
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className={kind === "poster" ? "aspect-[2/3]" : "aspect-video"}
                  />
                ))}
              </div>
            ) : listError ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {(listError as Error).message}
                {tab === "tmdb" && !integrations?.tmdbConfigured && (
                  <p className="mt-2">
                    Add a free TMDb API key in{" "}
                    <a href="/settings" className="text-primary hover:underline">
                      Settings → Integrations
                    </a>
                    .
                  </p>
                )}
              </div>
            ) : options && options.length > 0 ? (
              <div
                className={cn(
                  "grid gap-4",
                  kind === "poster"
                    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                    : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
                )}
              >
                {options.map((o, i) => (
                  <button
                    key={`${o.applyUrl}-${i}`}
                    disabled={apply.isPending}
                    onClick={() => apply.mutate(o.applyUrl)}
                    className={cn(
                      "group relative overflow-hidden rounded-md border transition-all duration-200 ease-out hover:-translate-y-1",
                      kind === "poster" ? "aspect-[2/3]" : "aspect-video",
                      o.selected
                        ? "border-primary ring-2 ring-primary"
                        : "border-border/60 hover:border-primary/60 hover:shadow-primary-glow",
                      apply.isPending && "opacity-50",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={o.previewUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80 backdrop-blur-sm">
                      {o.provider}
                    </span>
                    {o.selected && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-1 text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
                <ImageIcon className="h-8 w-8" />
                No {label}s found here.
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {isCollection
                ? "Paste an image link — or a whole ThePosterDB set link (theposterdb.com/set/…) to apply matching posters to every movie in this collection plus the collection poster."
                : "Paste an image link — ThePosterDB poster pages are converted automatically; MediUX asset links and any direct image URL work too."}
            </p>
            <div className="flex gap-2">
              <Input
                placeholder={isCollection ? "https://theposterdb.com/set/… or image link" : "https://…"}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !isValidUrl) return;
                  if (isCollection && isSetUrl) applySet.mutate();
                  else apply.mutate(cleanUrl);
                }}
              />
              <Button
                onClick={() =>
                  isCollection && isSetUrl ? applySet.mutate() : apply.mutate(cleanUrl)
                }
                disabled={
                  !isValidUrl || apply.isPending || applySet.isPending || setJob?.status === "running"
                }
                loading={apply.isPending || applySet.isPending}
              >
                <Link2 className="h-4 w-4" /> {isCollection && isSetUrl ? "Import set" : "Apply"}
              </Button>
            </div>

            {setJob && (
              <div className="space-y-2 rounded-md border border-border/60 bg-secondary/30 p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {setJob.status === "running" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      {setJob.current ?? "Working…"}
                    </>
                  ) : setJob.status === "error" ? (
                    <>
                      <XCircle className="h-4 w-4 text-destructive" /> {setJob.error}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-success" /> Applied{" "}
                      {setJob.results.filter((r) => r.status === "applied").length} of{" "}
                      {setJob.results.length} posters
                    </>
                  )}
                </p>
                <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                  {setJob.results.map((r, i) => (
                    <div key={`${r.title}-${i}`} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate">{r.title}</span>
                      {r.status === "applied" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                      ) : r.status === "no-match" ? (
                        <span className="text-xs text-muted-foreground">not in collection</span>
                      ) : (
                        <span className="max-w-48 truncate text-xs text-destructive" title={r.error}>
                          {r.error ?? "failed"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {setJob.status !== "running" && (
                  <Button size="sm" variant="outline" onClick={() => setSetJobId(null)}>
                    Import another
                  </Button>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              className="w-full"
              loading={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4" /> Upload an image file
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </Dialog>
  );
}
