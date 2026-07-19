"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, ImageIcon, Link2, Upload } from "lucide-react";
import type { ArtworkKind, ArtworkLinks, ArtworkOption, IntegrationsStatus } from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface PosterPickerProps {
  open: boolean;
  onClose: () => void;
  ratingKey: string;
  itemTitle: string;
  kind: ArtworkKind;
}

type Tab = "plex" | "tmdb" | "url";

export function PosterPicker({ open, onClose, ratingKey, itemTitle, kind }: PosterPickerProps) {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<Tab>("plex");
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["provenance", ratingKey] });
    qc.invalidateQueries({ queryKey: ["artwork", ratingKey] });
    qc.invalidateQueries({ queryKey: ["item", ratingKey] });
    qc.invalidateQueries({ queryKey: ["items"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["collection-children"] });
  };

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
      title={`Change ${label}`}
      className="max-w-3xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: "plex", label: "Plex" },
              { id: "tmdb", label: "TMDb" },
              { id: "url", label: "URL / Upload" },
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

        {tab !== "url" ? (
          <div className="max-h-[55vh] overflow-y-auto pr-1">
            {isLoading ? (
              <div
                className={cn(
                  "grid gap-3",
                  kind === "poster" ? "grid-cols-4" : "grid-cols-2",
                )}
              >
                {Array.from({ length: 8 }).map((_, i) => (
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
                  "grid gap-3",
                  kind === "poster" ? "grid-cols-4" : "grid-cols-2",
                )}
              >
                {options.map((o, i) => (
                  <button
                    key={`${o.applyUrl}-${i}`}
                    disabled={apply.isPending}
                    onClick={() => apply.mutate(o.applyUrl)}
                    className={cn(
                      "group relative overflow-hidden rounded-md border transition-all",
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
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Paste an image link — ThePosterDB poster pages (e.g.{" "}
              <code className="text-xs">theposterdb.com/poster/12345</code>) are converted to the
              image automatically; MediUX asset links and any direct image URL work too.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && url && apply.mutate(url)}
              />
              <Button
                onClick={() => apply.mutate(url)}
                disabled={!/^https?:\/\//.test(url)}
                loading={apply.isPending}
              >
                <Link2 className="h-4 w-4" /> Apply
              </Button>
            </div>
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
