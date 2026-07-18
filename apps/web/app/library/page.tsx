"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Library as LibraryIcon, Loader2, Search, SquarePlus, X } from "lucide-react";
import type { FilterOption, LibrarySection, MediaItem, PagedResult } from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Topbar } from "@/components/shell/topbar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PosterCard } from "@/components/library/poster-card";
import { ItemDrawer } from "@/components/library/item-drawer";
import { AddToCollectionDialog } from "@/components/library/add-to-collection-dialog";

const PAGE_SIZE = 60;

const SORTS = [
  { id: "titleSort:asc", label: "Title A→Z" },
  { id: "titleSort:desc", label: "Title Z→A" },
  { id: "addedAt:desc", label: "Recently added" },
  { id: "year:desc", label: "Newest first" },
  { id: "year:asc", label: "Oldest first" },
  { id: "audienceRating:desc", label: "Top rated" },
];

export default function LibraryPage() {
  return (
    <Suspense>
      <LibraryPageInner />
    </Suspense>
  );
}

function LibraryPageInner() {
  const router = useRouter();
  const params = useSearchParams();

  const { data: sections, isLoading: sectionsLoading } = useQuery({
    queryKey: ["sections"],
    queryFn: () => api<LibrarySection[]>("/api/library/sections"),
    retry: false,
  });

  const sectionId = params.get("section") ?? sections?.[0]?.id;

  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [sort, setSort] = React.useState(SORTS[0].id);
  const [genre, setGenre] = React.useState("");
  const [unwatched, setUnwatched] = React.useState(false);
  const [openItem, setOpenItem] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset filters and selection when switching libraries
  React.useEffect(() => {
    setSelected(new Set());
    setGenre("");
  }, [sectionId]);

  const { data: genres } = useQuery({
    queryKey: ["genres", sectionId],
    queryFn: () => api<FilterOption[]>(`/api/library/sections/${sectionId}/genres`),
    enabled: !!sectionId,
  });

  const query = useInfiniteQuery({
    queryKey: ["items", sectionId, debouncedSearch, sort, genre, unwatched],
    enabled: !!sectionId,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        offset: String(pageParam),
        limit: String(PAGE_SIZE),
        sort,
      });
      if (debouncedSearch) qs.set("search", debouncedSearch);
      if (genre) qs.set("genre", genre);
      if (unwatched) qs.set("unwatched", "true");
      return api<PagedResult<MediaItem>>(`/api/library/sections/${sectionId}/items?${qs}`);
    },
    getNextPageParam: (last) => {
      const next = last.offset + PAGE_SIZE;
      return next < last.totalSize ? next : undefined;
    },
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const totalSize = query.data?.pages[0]?.totalSize;

  const sentinelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          query.fetchNextPage();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  const toggleSelect = (ratingKey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ratingKey)) next.delete(ratingKey);
      else next.add(ratingKey);
      return next;
    });
  };

  const notConnected = !sectionsLoading && (!sections || sections.length === 0);

  return (
    <main>
      <Topbar
        title="Library"
        actions={
          totalSize !== undefined ? (
            <span className="mr-2 text-sm text-muted-foreground">
              {totalSize.toLocaleString()} items
            </span>
          ) : undefined
        }
      />

      <div className="space-y-4 p-6 pb-24">
        {notConnected ? (
          <EmptyState
            icon={LibraryIcon}
            title="No libraries found"
            description="Connect your Plex server in Settings to browse your libraries."
          />
        ) : (
          <>
            {/* Section pills */}
            <div className="flex flex-wrap gap-2">
              {sections?.map((s) => (
                <button
                  key={s.id}
                  onClick={() => router.replace(`/library?section=${s.id}`)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                    s.id === sectionId
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {s.title}
                </button>
              ))}
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search titles…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-64 pl-9"
                />
              </div>
              <NativeSelect value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect value={genre} onChange={(e) => setGenre(e.target.value)}>
                <option value="">All genres</option>
                {genres?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </NativeSelect>
              <button
                onClick={() => setUnwatched((v) => !v)}
                className={cn(
                  "h-9 rounded-md border px-3 text-sm font-medium transition-colors",
                  unwatched
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                Unwatched
              </button>
            </div>

            {/* Grid */}
            {query.isLoading ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
                {Array.from({ length: 18 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[2/3] rounded-lg" />
                ))}
              </div>
            ) : query.isError ? (
              <EmptyState
                icon={LibraryIcon}
                title="Couldn't load this library"
                description={(query.error as Error).message}
              />
            ) : items.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No matches"
                description="Try a different search or clear the filters."
              />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
                {items.map((item) => (
                  <PosterCard
                    key={item.ratingKey}
                    item={item}
                    selected={selected.has(item.ratingKey)}
                    selectionMode={selected.size > 0}
                    onClick={() => setOpenItem(item.ratingKey)}
                    onToggleSelect={() => toggleSelect(item.ratingKey)}
                  />
                ))}
              </div>
            )}

            <div ref={sentinelRef} className="flex justify-center py-4">
              {query.isFetchingNextPage && (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              )}
            </div>
          </>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && sectionId && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-popover/90 py-2 pl-5 pr-2 shadow-xl backdrop-blur-xl">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            <SquarePlus className="h-4 w-4" /> Add to collection
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

      {sectionId && (
        <>
          <ItemDrawer
            ratingKey={openItem}
            sectionId={sectionId}
            onClose={() => setOpenItem(null)}
          />
          <AddToCollectionDialog
            open={bulkOpen}
            onClose={() => setBulkOpen(false)}
            sectionId={sectionId}
            itemRatingKeys={[...selected]}
            onDone={() => setSelected(new Set())}
          />
        </>
      )}
    </main>
  );
}
