"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Search, SquareStack, Trash2, X } from "lucide-react";
import type { EditCollectionInput, MediaItem, PagedResult, PlexCollection } from "@metamagic/shared";
import { api } from "@/lib/api";
import { imageUrl } from "@/lib/utils";
import { Topbar } from "@/components/shell/topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ItemDrawer } from "@/components/library/item-drawer";
import { PosterPicker } from "@/components/library/poster-picker";

export default function CollectionsPage() {
  const qc = useQueryClient();
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [openItem, setOpenItem] = React.useState<string | null>(null);
  const [addSearch, setAddSearch] = React.useState("");
  const [debouncedAddSearch, setDebouncedAddSearch] = React.useState("");

  const { data: collections, isLoading } = useQuery({
    queryKey: ["collections", "all"],
    queryFn: () => api<PlexCollection[]>("/api/collections"),
    retry: false,
  });

  const open = collections?.find((c) => c.ratingKey === openKey) ?? null;

  const { data: children, isLoading: childrenLoading } = useQuery({
    queryKey: ["collection-children", openKey],
    queryFn: () => api<MediaItem[]>(`/api/collections/${openKey}/items`),
    enabled: !!openKey,
  });

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedAddSearch(addSearch), 300);
    return () => clearTimeout(t);
  }, [addSearch]);

  React.useEffect(() => {
    setEditing(false);
    setAddSearch("");
    setOpenItem(null);
  }, [openKey]);

  const { data: addCandidates } = useQuery({
    queryKey: ["collection-add-search", open?.sectionId, debouncedAddSearch],
    queryFn: () =>
      api<PagedResult<MediaItem>>(
        `/api/library/sections/${open!.sectionId}/items?search=${encodeURIComponent(debouncedAddSearch)}&limit=10`,
      ),
    enabled: !!open?.sectionId && debouncedAddSearch.length > 1,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["collection-children"] });
    qc.invalidateQueries({ queryKey: ["items"] });
    qc.invalidateQueries({ queryKey: ["item"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const editCollection = useMutation({
    mutationFn: (input: EditCollectionInput) =>
      api(`/api/collections/${openKey}/edit`, { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });

  const addItem = useMutation({
    mutationFn: (itemRatingKey: string) =>
      api(`/api/collections/${openKey}/items`, {
        method: "POST",
        body: JSON.stringify({ itemRatingKeys: [itemRatingKey] }),
      }),
    onSuccess: invalidate,
  });

  const removeItem = useMutation({
    mutationFn: (itemRatingKey: string) =>
      api(`/api/collections/${openKey}/items/${itemRatingKey}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const deleteCollection = useMutation({
    mutationFn: () => api(`/api/collections/${openKey}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(false);
      setOpenKey(null);
    },
  });

  const childKeys = new Set(children?.map((c) => c.ratingKey) ?? []);
  const candidates = addCandidates?.items.filter((i) => !childKeys.has(i.ratingKey)) ?? [];

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
              <button
                key={c.ratingKey}
                onClick={() => setOpenKey(c.ratingKey)}
                className="group text-left"
              >
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

      <Sheet open={!!open} onClose={() => setOpenKey(null)}>
        {open && (
          <div className="space-y-5 p-6">
            <div className="flex items-start gap-4 pr-8">
              <button
                onClick={() => setPickerOpen(true)}
                className="group/cposter relative h-36 w-24 shrink-0 overflow-hidden rounded-lg border border-border shadow-lg"
                title="Change collection poster"
              >
                {open.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl(open.thumb, 200, 300)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center bg-secondary/60">
                    <SquareStack className="h-6 w-6 text-muted-foreground" />
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-center text-xs font-medium text-white opacity-0 transition-opacity group-hover/cposter:opacity-100">
                  Change poster
                </span>
              </button>

              <div className="min-w-0 flex-1">
                {editing ? (
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                ) : (
                  <h2 className="text-xl font-bold">{open.title}</h2>
                )}
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge variant="secondary">
                    {open.childCount} item{open.childCount === 1 ? "" : "s"}
                  </Badge>
                  {open.sectionTitle && <Badge variant="outline">{open.sectionTitle}</Badge>}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {editing ? (
                    <>
                      <Button
                        size="sm"
                        loading={editCollection.isPending}
                        onClick={() =>
                          editCollection.mutate({ title: title.trim() || undefined, summary })
                        }
                      >
                        <Check className="h-3.5 w-3.5" /> Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTitle(open.title);
                          setSummary(open.summary ?? "");
                          setEditing(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setConfirmDelete(true)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {editing ? (
              <div className="space-y-1.5">
                <Label htmlFor="csummary">Summary</Label>
                <textarea
                  id="csummary"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            ) : (
              open.summary && <p className="text-sm text-muted-foreground">{open.summary}</p>
            )}

            {/* Add items */}
            <div className="space-y-2 border-t border-border pt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Add items
              </h3>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search this library…"
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {debouncedAddSearch.length > 1 && (
                <div className="space-y-1">
                  {candidates.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-muted-foreground">
                      No matches outside this collection.
                    </p>
                  ) : (
                    candidates.map((i) => (
                      <button
                        key={i.ratingKey}
                        disabled={addItem.isPending}
                        onClick={() => addItem.mutate(i.ratingKey)}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary/60 disabled:opacity-50"
                      >
                        {i.thumb && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={imageUrl(i.thumb, 60, 90)}
                            alt=""
                            className="h-12 w-8 rounded object-cover"
                          />
                        )}
                        <span className="flex-1 truncate">
                          {i.title}
                          {i.year ? (
                            <span className="text-muted-foreground"> ({i.year})</span>
                          ) : null}
                        </span>
                        <Plus className="h-4 w-4 text-primary" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Children */}
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
                    <button
                      onClick={() => setOpenItem(item.ratingKey)}
                      className="block w-full overflow-hidden rounded-md border border-border/60 bg-secondary/40 transition-all hover:border-primary/50"
                    >
                      <div className="aspect-[2/3]">
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
                    </button>
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

      {open && (
        <ItemDrawer
          ratingKey={openItem}
          sectionId={open.sectionId ?? ""}
          onClose={() => setOpenItem(null)}
        />
      )}

      {open && pickerOpen && (
        <PosterPicker
          open
          onClose={() => setPickerOpen(false)}
          ratingKey={open.ratingKey}
          itemTitle={open.title}
          kind="poster"
        />
      )}

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
