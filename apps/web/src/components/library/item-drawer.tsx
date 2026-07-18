"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Star, X } from "lucide-react";
import type { MediaItem, PlexCollection } from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn, formatDuration, imageUrl } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AddToCollectionDialog } from "./add-to-collection-dialog";

interface ItemDrawerProps {
  ratingKey: string | null;
  sectionId: string;
  onClose: () => void;
}

export function ItemDrawer({ ratingKey, sectionId, onClose }: ItemDrawerProps) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);

  const { data: item, isLoading } = useQuery({
    queryKey: ["item", ratingKey],
    queryFn: () => api<MediaItem>(`/api/library/items/${ratingKey}`),
    enabled: !!ratingKey,
  });

  // Item metadata only carries collection titles; resolve titles -> ratingKeys
  // via the section's collection list so we can remove memberships.
  const { data: collections } = useQuery({
    queryKey: ["collections", sectionId],
    queryFn: () => api<PlexCollection[]>(`/api/collections?sectionId=${sectionId}`),
    enabled: !!ratingKey,
  });

  const removeFromCollection = useMutation({
    mutationFn: (collectionRatingKey: string) =>
      api(`/api/collections/${collectionRatingKey}/items/${ratingKey}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item", ratingKey] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });

  const collectionByTitle = new Map(collections?.map((c) => [c.title, c]) ?? []);

  return (
    <Sheet open={!!ratingKey} onClose={onClose}>
      {isLoading || !item ? (
        <div className="space-y-4 p-6">
          <Skeleton className="h-72 w-48" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div>
          <div
            className="relative h-40 bg-cover bg-center"
            style={{
              backgroundImage: item.art ? `url(${imageUrl(item.art, 800, 450)})` : undefined,
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
          </div>

          <div className="relative -mt-20 space-y-5 p-6">
            <div className="flex gap-4">
              {item.thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl(item.thumb, 200, 300)}
                  alt=""
                  className="h-44 w-[7.3rem] shrink-0 rounded-lg border border-border object-cover shadow-lg"
                />
              )}
              <div className="min-w-0 self-end">
                <h2 className="text-xl font-bold leading-tight">{item.title}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {item.year && <Badge variant="secondary">{item.year}</Badge>}
                  {item.contentRating && <Badge variant="outline">{item.contentRating}</Badge>}
                  {item.videoResolution && (
                    <Badge variant="outline" className="uppercase">
                      {item.videoResolution}
                    </Badge>
                  )}
                  {formatDuration(item.duration) && (
                    <Badge variant="outline">{formatDuration(item.duration)}</Badge>
                  )}
                  {item.audienceRating && (
                    <Badge variant="secondary">
                      <Star className="h-3 w-3 fill-warning text-warning" />
                      {item.audienceRating.toFixed(1)}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {item.summary && (
              <p className="text-sm leading-relaxed text-muted-foreground">{item.summary}</p>
            )}

            {item.genres && item.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {item.genres.map((g) => (
                  <Badge key={g} variant="outline">
                    {g}
                  </Badge>
                ))}
              </div>
            )}

            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Collections
                </h3>
                <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
              {item.collections && item.collections.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {item.collections.map((c) => {
                    const collection = collectionByTitle.get(c.tag);
                    return (
                      <Badge key={c.tag} className="pr-1">
                        {c.tag}
                        {collection && (
                          <button
                            aria-label={`Remove from ${c.tag}`}
                            disabled={removeFromCollection.isPending}
                            onClick={() => removeFromCollection.mutate(collection.ratingKey)}
                            className={cn(
                              "ml-0.5 rounded-full p-0.5 hover:bg-primary/25",
                              removeFromCollection.isPending && "opacity-50",
                            )}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </Badge>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Not in any collection yet.</p>
              )}
            </div>
          </div>

          {ratingKey && (
            <AddToCollectionDialog
              open={addOpen}
              onClose={() => setAddOpen(false)}
              sectionId={sectionId}
              itemRatingKeys={[ratingKey]}
            />
          )}
        </div>
      )}
    </Sheet>
  );
}
