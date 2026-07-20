"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Pencil, Plus, Search, SquareStack, Trash2, X } from "lucide-react";
import type {
  CollectionCompleteness,
  EditCollectionInput,
  LibrarySection,
  MediaItem,
  PagedResult,
  PlexCollection,
  TmdbCollectionOption,
} from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn, imageUrl } from "@/lib/utils";
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
import { ProvenanceNote } from "@/components/library/provenance-note";
import { DiscoverPanel } from "@/components/rules/discover-panel";

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
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmMassDelete, setConfirmMassDelete] = React.useState(false);

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

  const { data: completeness } = useQuery({
    queryKey: ["collection-missing", openKey],
    queryFn: () => api<CollectionCompleteness>(`/api/collections/${openKey}/missing`),
    enabled: !!openKey,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const [hideNotInLibrary, setHideNotInLibrary] = React.useState(false);
  const [hideUnreleased, setHideUnreleased] = React.useState(true);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const visibleMissing =
    completeness?.missing.filter(
      (m) => !(hideNotInLibrary && !m.ratingKey) && !(hideUnreleased && m.unreleased),
    ) ?? [];
  const hiddenCount = (completeness?.missing.length ?? 0) - visibleMissing.length;

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
    qc.invalidateQueries({ queryKey: ["collection-missing"] });
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

  const massDelete = useMutation({
    mutationFn: async () => {
      for (const key of selected) {
        await api(`/api/collections/${key}`, { method: "DELETE" });
      }
    },
    onSuccess: () => {
      invalidate();
      setSelected(new Set());
      setConfirmMassDelete(false);
    },
  });

  const toggleSelect = (ratingKey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ratingKey)) next.delete(ratingKey);
      else next.add(ratingKey);
      return next;
    });
  };

  const childKeys = new Set(children?.map((c) => c.ratingKey) ?? []);
  const candidates =
    addCandidates?.items.filter(
      (i) => !childKeys.has(i.ratingKey) && i.type !== "collection" && i.ratingKey !== openKey,
    ) ?? [];

  return (
    <main>
      <Topbar
        title="Collections"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New collection
          </Button>
        }
      />
      <div className="space-y-6 p-6 pb-24">
        <DiscoverPanel />

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
            {collections.map((c) => {
              const isSelected = selected.has(c.ratingKey);
              const selectionMode = selected.size > 0;
              return (
                <div key={c.ratingKey} className="group relative">
                  <button
                    onClick={() =>
                      selectionMode ? toggleSelect(c.ratingKey) : setOpenKey(c.ratingKey)
                    }
                    className="block w-full text-left"
                  >
                    <div
                      className={cn(
                        "aspect-[2/3] overflow-hidden rounded-lg border bg-secondary/40 transition-all",
                        isSelected
                          ? "border-primary ring-2 ring-primary"
                          : "border-border/60 group-hover:border-primary/50 group-hover:shadow-primary-glow",
                      )}
                    >
                      {c.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl(c.thumb, 360, 540)}
                          alt=""
                          loading="lazy"
                          className={cn(
                            "h-full w-full object-cover transition-transform duration-200",
                            !selectionMode && "group-hover:scale-[1.03]",
                            isSelected && "opacity-80",
                          )}
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
                  <button
                    onClick={() => toggleSelect(c.ratingKey)}
                    aria-label={isSelected ? "Deselect" : "Select"}
                    className={cn(
                      "absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border transition-all",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-white/50 bg-black/50 text-transparent opacity-0 backdrop-blur group-hover:opacity-100",
                      selectionMode && "opacity-100",
                    )}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-popover/90 py-2 pl-5 pr-2 shadow-xl backdrop-blur-xl">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="destructive" onClick={() => setConfirmMassDelete(true)}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

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

            <ProvenanceNote ratingKey={open.ratingKey} />

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
            <div className="space-y-2 pt-2">
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

            {/* Missing from this collection (matched via TMDb) */}
            {completeness && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Missing from this collection
                  </h3>
                  <button
                    onClick={() => setLinkOpen(true)}
                    className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                  >
                    {completeness.tmdbCollectionName ? "Change match" : "Pick a TMDb collection"}
                  </button>
                </div>

                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {completeness.tmdbCollectionName ? (
                    <>
                      Comparing against
                      <a
                        href={completeness.tmdbCollectionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                      >
                        {completeness.tmdbCollectionName} <ExternalLink className="h-3 w-3" />
                      </a>
                      <Badge variant={completeness.matchSource === "title" ? "outline" : "secondary"}>
                        {completeness.matchSource === "manual"
                          ? "pinned by you"
                          : completeness.matchSource === "contents"
                            ? "matched from contents"
                            : "guessed from title"}
                      </Badge>
                    </>
                  ) : (
                    "No TMDb collection matched — pick one to see what's missing."
                  )}
                </p>
                {completeness.missing.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setHideUnreleased((v) => !v)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                        hideUnreleased
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Hide unreleased
                    </button>
                    <button
                      onClick={() => setHideNotInLibrary((v) => !v)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                        hideNotInLibrary
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Hide not-in-library
                    </button>
                  </div>
                )}
                {visibleMissing.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-sm text-success">
                    <Check className="h-4 w-4" />
                    {completeness.missing.length === 0
                      ? "Complete — every entry from TMDb is here."
                      : `Complete — ${hiddenCount} hidden by filters.`}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {visibleMissing.map((m) => (
                      <div
                        key={m.tmdbId}
                        className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm"
                      >
                        {m.posterUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.posterUrl}
                            alt=""
                            loading="lazy"
                            className="h-12 w-8 rounded object-cover"
                          />
                        ) : (
                          <span className="flex h-12 w-8 items-center justify-center rounded bg-secondary text-muted-foreground">
                            ?
                          </span>
                        )}
                        <span className="flex-1 truncate">
                          {m.title}
                          {m.year ? (
                            <span className="text-muted-foreground"> ({m.year})</span>
                          ) : null}
                          {m.unreleased && (
                            <Badge variant="outline" className="ml-1.5">
                              unreleased
                            </Badge>
                          )}
                        </span>
                        {m.ratingKey ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={addItem.isPending}
                            onClick={() => addItem.mutate(m.ratingKey!)}
                          >
                            <Plus className="h-3.5 w-3.5" /> Add
                          </Button>
                        ) : (
                          <Badge variant="outline">not in library</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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

      {open && (
        <LinkCollectionDialog
          open={linkOpen}
          onClose={() => setLinkOpen(false)}
          ratingKey={open.ratingKey}
          collectionTitle={open.title}
          currentId={completeness?.tmdbCollectionId}
          isPinned={completeness?.matchSource === "manual"}
        />
      )}

      {open && pickerOpen && (
        <PosterPicker
          open
          onClose={() => setPickerOpen(false)}
          ratingKey={open.ratingKey}
          itemTitle={open.title}
          kind="poster"
          itemType="collection"
        />
      )}

      <NewCollectionDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(ratingKey) => {
          invalidate();
          setCreateOpen(false);
          setOpenKey(ratingKey);
        }}
      />

      <Dialog
        open={confirmMassDelete}
        onClose={() => setConfirmMassDelete(false)}
        title={`Delete ${selected.size} collection${selected.size === 1 ? "" : "s"}?`}
      >
        <p className="text-sm text-muted-foreground">
          The selected collections will be deleted from Plex. The movies and shows inside them
          are not touched.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmMassDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={massDelete.isPending}
            onClick={() => massDelete.mutate()}
          >
            Delete {selected.size}
          </Button>
        </div>
      </Dialog>

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

function LinkCollectionDialog({
  open,
  onClose,
  ratingKey,
  collectionTitle,
  currentId,
  isPinned,
}: {
  open: boolean;
  onClose: () => void;
  ratingKey: string;
  collectionTitle: string;
  currentId?: number;
  isPinned?: boolean;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");

  React.useEffect(() => {
    if (open) setQuery(collectionTitle.replace(/\s+collection\s*$/i, "").trim());
  }, [open, collectionTitle]);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: options, isFetching } = useQuery({
    queryKey: ["tmdb-collections", debounced],
    queryFn: () =>
      api<TmdbCollectionOption[]>(`/api/tmdb/collections?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.trim().length > 1,
  });

  const finish = () => {
    qc.invalidateQueries({ queryKey: ["collection-missing"] });
    onClose();
  };

  const link = useMutation({
    mutationFn: (option: TmdbCollectionOption) =>
      api(`/api/collections/${ratingKey}/link`, {
        method: "PUT",
        body: JSON.stringify({ tmdbCollectionId: option.id, tmdbCollectionName: option.name }),
      }),
    onSuccess: finish,
  });

  const unlink = useMutation({
    mutationFn: () => api(`/api/collections/${ratingKey}/link`, { method: "DELETE" }),
    onSuccess: finish,
  });

  return (
    <Dialog open={open} onClose={onClose} title="Which TMDb collection is this?" className="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          MetaMagic uses this to work out what’s missing. Search for the franchise — e.g. “The Lord
          of the Rings” — and pick the collection that holds the actual movies.
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search TMDb collections…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {isFetching && !options ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">Searching…</p>
          ) : options && options.length > 0 ? (
            options.map((o) => (
              <button
                key={o.id}
                disabled={link.isPending}
                onClick={() => link.mutate(o)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary/60 disabled:opacity-50",
                  o.id === currentId && "bg-secondary/60",
                )}
              >
                {o.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.posterUrl} alt="" className="h-12 w-8 rounded object-cover" />
                ) : (
                  <span className="h-12 w-8 rounded bg-secondary" />
                )}
                <span className="flex-1 truncate">{o.name}</span>
                {o.id === currentId ? (
                  <Badge variant="success">current</Badge>
                ) : (
                  <Plus className="h-4 w-4 text-primary" />
                )}
              </button>
            ))
          ) : debounced.trim().length > 1 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              No TMDb collections matched that search.
            </p>
          ) : null}
        </div>

        {isPinned && (
          <Button variant="outline" size="sm" loading={unlink.isPending} onClick={() => unlink.mutate()}>
            Clear pin (back to automatic)
          </Button>
        )}
      </div>
    </Dialog>
  );
}

function NewCollectionDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ratingKey: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [sectionId, setSectionId] = React.useState<string>("");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [picked, setPicked] = React.useState<Map<string, MediaItem>>(new Map());
  const [error, setError] = React.useState<string | null>(null);

  const { data: sections } = useQuery({
    queryKey: ["sections"],
    queryFn: () => api<LibrarySection[]>("/api/library/sections"),
    enabled: open,
  });

  React.useEffect(() => {
    if (!sectionId && sections?.length) setSectionId(sections[0].id);
  }, [sections, sectionId]);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    setPicked(new Map());
    setSearch("");
  }, [sectionId]);

  const { data: found } = useQuery({
    queryKey: ["create-collection-search", sectionId, debounced],
    queryFn: () =>
      api<PagedResult<MediaItem>>(
        `/api/library/sections/${sectionId}/items?search=${encodeURIComponent(debounced)}&limit=8`,
      ),
    enabled: open && !!sectionId && debounced.length > 1,
  });

  const create = useMutation({
    mutationFn: () =>
      api<PlexCollection>("/api/collections", {
        method: "POST",
        body: JSON.stringify({
          sectionId,
          title: name.trim(),
          itemRatingKeys: [...picked.keys()],
        }),
      }),
    onSuccess: (created) => {
      setName("");
      setPicked(new Map());
      setError(null);
      onCreated(created.ratingKey);
    },
    onError: (e) => setError((e as Error).message),
  });

  return (
    <Dialog open={open} onClose={onClose} title="New collection">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="nc-name">Name</Label>
          <Input
            id="nc-name"
            placeholder="e.g. Fast & Furious"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {sections && sections.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setSectionId(s.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  s.id === sectionId
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="nc-search">Add at least one item</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="nc-search"
              placeholder="Search this library…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {picked.size > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[...picked.values()].map((i) => (
              <Badge key={i.ratingKey} variant="secondary" className="pr-1">
                {i.title}
                <button
                  aria-label={`Remove ${i.title}`}
                  onClick={() =>
                    setPicked((prev) => {
                      const next = new Map(prev);
                      next.delete(i.ratingKey);
                      return next;
                    })
                  }
                  className="ml-0.5 rounded-full p-0.5 hover:bg-secondary-foreground/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {debounced.length > 1 && (
          <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
            {found?.items
              .filter((i) => !picked.has(i.ratingKey) && i.type !== "collection")
              .map((i) => (
                <button
                  key={i.ratingKey}
                  onClick={() => setPicked((prev) => new Map(prev).set(i.ratingKey, i))}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary/60"
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
                    {i.year ? <span className="text-muted-foreground"> ({i.year})</span> : null}
                  </span>
                  <Plus className="h-4 w-4 text-primary" />
                </button>
              ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          className="w-full"
          loading={create.isPending}
          disabled={!name.trim() || picked.size === 0 || !sectionId}
          onClick={() => create.mutate()}
        >
          Create collection with {picked.size || "…"} item{picked.size === 1 ? "" : "s"}
        </Button>
      </div>
    </Dialog>
  );
}
