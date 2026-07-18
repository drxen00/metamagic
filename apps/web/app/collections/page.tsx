"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SquareStack, Trash2, X } from "lucide-react";
import type { MediaItem, PlexCollection } from "@metamagic/shared";
import { api } from "@/lib/api";
import { imageUrl } from "@/lib/utils";
import { Topbar } from "@/components/shell/topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

export default function CollectionsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState<PlexCollection | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const { data: collections, isLoading } = useQuery({
    queryKey: ["collections", "all"],
    queryFn: () => api<PlexCollection[]>("/api/collections"),
    retry: false,
  });

  const { data: children, isLoading: childrenLoading } = useQuery({
    queryKey: ["collection-children", open?.ratingKey],
    queryFn: () => api<MediaItem[]>(`/api/collections/${open!.ratingKey}/items`),
    enabled: !!open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["collection-children"] });
    qc.invalidateQueries({ queryKey: ["items"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const removeItem = useMutation({
    mutationFn: (itemRatingKey: string) =>
      api(`/api/collections/${open!.ratingKey}/items/${itemRatingKey}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const deleteCollection = useMutation({
    mutationFn: () => api(`/api/collections/${open!.ratingKey}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(false);
      setOpen(null);
    },
  });

  return (
    <main>
      <Topbar title="Collections" />
      <div className="p-6">
        {isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[2/3] rounded-lg" />
            ))}
          </div>
        ) : !collections || collections.length === 0 ? (
          <EmptyState
            icon={SquareStack}
            title="No collections yet"
            description="Select items in the Library (hover a poster and hit the checkmark), then use “Add to collection” to create your first one."
            action={
              <Button variant="outline" className="mt-2">
                <Link href="/library">Browse Library</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {collections.map((c) => (
              <button key={c.ratingKey} onClick={() => setOpen(c)} className="group text-left">
                <div className="aspect-[2/3] overflow-hidden rounded-lg border border-border/60 bg-secondary/40 transition-all group-hover:border-primary/50 group-hover:shadow-primary-glow">
                  {c.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl(c.thumb, 360, 540)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <SquareStack className="h-10 w-10 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
                <div className="mt-2 px-0.5">
                  <p className="truncate font-medium leading-tight">{c.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.childCount} item{c.childCount === 1 ? "" : "s"}
                    {c.sectionTitle ? ` · ${c.sectionTitle}` : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-5 p-6">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div>
                <h2 className="text-xl font-bold">{open.title}</h2>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge variant="secondary">
                    {open.childCount} item{open.childCount === 1 ? "" : "s"}
                  </Badge>
                  {open.sectionTitle && <Badge variant="outline">{open.sectionTitle}</Badge>}
                </div>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>

            {open.summary && <p className="text-sm text-muted-foreground">{open.summary}</p>}

            {childrenLoading ? (
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[2/3] rounded-md" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {children?.map((item) => (
                  <div key={item.ratingKey} className="group relative">
                    <div className="aspect-[2/3] overflow-hidden rounded-md border border-border/60 bg-secondary/40">
                      {item.thumb && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl(item.thumb, 200, 300)}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <button
                      aria-label={`Remove ${item.title}`}
                      disabled={removeItem.isPending}
                      onClick={() => removeItem.mutate(item.ratingKey)}
                      className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white/80 opacity-0 backdrop-blur transition-opacity hover:bg-destructive hover:text-white group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <p className="mt-1 truncate text-xs">{item.title}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Sheet>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete collection?"
      >
        <p className="text-sm text-muted-foreground">
          “{open?.title}” will be deleted from Plex. The movies and shows inside it are not touched.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={deleteCollection.isPending}
            onClick={() => deleteCollection.mutate()}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
