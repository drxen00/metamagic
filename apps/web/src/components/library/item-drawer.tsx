"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImageIcon, Pencil, Plus, Star, Tag, X } from "lucide-react";
import type { ArtworkKind, EditItemInput, MediaItem, PlexCollection } from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn, formatDuration, imageUrl } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AddToCollectionDialog } from "./add-to-collection-dialog";
import { PosterPicker } from "./poster-picker";

interface ItemDrawerProps {
  ratingKey: string | null;
  sectionId: string;
  onClose: () => void;
}

export function ItemDrawer({ ratingKey, sectionId, onClose }: ItemDrawerProps) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [pickerKind, setPickerKind] = React.useState<ArtworkKind | null>(null);
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [editError, setEditError] = React.useState<string | null>(null);

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

  React.useEffect(() => {
    setEditing(false);
    setEditError(null);
  }, [ratingKey]);

  const invalidateItem = () => {
    qc.invalidateQueries({ queryKey: ["item", ratingKey] });
    qc.invalidateQueries({ queryKey: ["items"] });
  };

  const edit = useMutation({
    mutationFn: (input: EditItemInput) =>
      api(`/api/items/${ratingKey}/edit`, { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => {
      invalidateItem();
      setEditError(null);
    },
    onError: (e) => setEditError((e as Error).message),
  });

  const saveFields = () => {
    edit.mutate(
      { title: title.trim() || undefined, summary },
      { onSuccess: () => setEditing(false) },
    );
  };

  const removeFromCollection = useMutation({
    mutationFn: (collectionRatingKey: string) =>
      api(`/api/collections/${collectionRatingKey}/items/${ratingKey}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateItem();
      qc.invalidateQueries({ queryKey: ["collections"] });
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
            className="group/art relative h-40 bg-cover bg-center"
            style={{
              backgroundImage: item.art ? `url(${imageUrl(item.art, 800, 450)})` : undefined,
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
            <button
              onClick={() => setPickerKind("art")}
              className="absolute right-12 top-4 inline-flex items-center gap-1.5 rounded-md bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-foreground group-hover/art:opacity-100"
            >
              <ImageIcon className="h-3.5 w-3.5" /> Change background
            </button>
          </div>

          <div className="relative -mt-20 space-y-5 p-6">
            <div className="flex gap-4">
              <button
                onClick={() => setPickerKind("poster")}
                className="group/poster relative h-44 w-[7.3rem] shrink-0 overflow-hidden rounded-lg border border-border shadow-lg"
                title="Change poster"
              >
                {item.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl(item.thumb, 200, 300)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center bg-secondary/60">
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-medium text-white opacity-0 transition-opacity group-hover/poster:opacity-100">
                  Change poster
                </span>
              </button>

              <div className="min-w-0 flex-1 self-end">
                {editing ? (
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="text-lg font-bold"
                  />
                ) : (
                  <h2 className="text-xl font-bold leading-tight">{item.title}</h2>
                )}
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

            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <Button size="sm" loading={edit.isPending} onClick={saveFields}>
                    <Check className="h-3.5 w-3.5" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTitle(item.title);
                    setSummary(item.summary ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit metadata
                </Button>
              )}
              {editError && <p className="text-xs text-destructive">{editError}</p>}
            </div>

            {editing ? (
              <div className="space-y-1.5">
                <Label htmlFor="summary">Summary</Label>
                <textarea
                  id="summary"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={5}
                  className="w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            ) : (
              item.summary && (
                <p className="text-sm leading-relaxed text-muted-foreground">{item.summary}</p>
              )
            )}

            <TagEditor
              icon={<Tag className="h-3.5 w-3.5" />}
              heading="Labels"
              tags={item.labels ?? []}
              placeholder="Add label…"
              onAdd={(tag) => edit.mutate({ addLabels: [tag] })}
              onRemove={(tag) => edit.mutate({ removeLabels: [tag] })}
              busy={edit.isPending}
            />

            <TagEditor
              heading="Genres"
              tags={item.genres ?? []}
              placeholder="Add genre…"
              onAdd={(tag) => edit.mutate({ addGenres: [tag] })}
              onRemove={(tag) => edit.mutate({ removeGenres: [tag] })}
              busy={edit.isPending}
            />

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
            <>
              <AddToCollectionDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                sectionId={item.librarySectionId ?? sectionId}
                itemRatingKeys={[ratingKey]}
              />
              {pickerKind && (
                <PosterPicker
                  open
                  onClose={() => setPickerKind(null)}
                  ratingKey={ratingKey}
                  itemTitle={item.title}
                  kind={pickerKind}
                />
              )}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

function TagEditor({
  icon,
  heading,
  tags,
  placeholder,
  onAdd,
  onRemove,
  busy,
}: {
  icon?: React.ReactNode;
  heading: string;
  tags: string[];
  placeholder: string;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  busy?: boolean;
}) {
  const [value, setValue] = React.useState("");

  const submit = () => {
    const tag = value.trim();
    if (!tag) return;
    onAdd(tag);
    setValue("");
  };

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {heading}
      </h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline" className="pr-1">
            {tag}
            <button
              aria-label={`Remove ${tag}`}
              disabled={busy}
              onClick={() => onRemove(tag)}
              className={cn("ml-0.5 rounded-full p-0.5 hover:bg-secondary", busy && "opacity-50")}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          onBlur={() => value.trim() && submit()}
          placeholder={placeholder}
          disabled={busy}
          className="h-7 w-28 rounded-full border border-dashed border-border bg-transparent px-3 text-xs placeholder:text-muted-foreground focus-visible:border-solid focus-visible:border-primary focus-visible:outline-none"
        />
      </div>
    </div>
  );
}
