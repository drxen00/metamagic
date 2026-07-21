"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  History,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import type {
  Badge as BadgeSpec,
  BadgePosition,
  BadgeType,
  LibrarySection,
  MediaItem,
  OverlayPreset,
  OverlayStatus,
} from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn, imageUrl } from "@/lib/utils";
import { Topbar } from "@/components/shell/topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ColorPicker } from "@/components/ui/color-picker";
import { JobLog } from "@/components/rules/job-log";

const BADGE_TYPES: { id: BadgeType; label: string; hint: string }[] = [
  { id: "resolution", label: "Resolution", hint: "4K / 1080p / 720p" },
  { id: "hdr", label: "HDR", hint: "Dolby Vision / HDR" },
  { id: "audio", label: "Audio", hint: "TrueHD / DTS / DD+" },
  { id: "rating", label: "Rating", hint: "★ audience score" },
  { id: "new", label: "New", hint: "recently added" },
  { id: "text", label: "Custom text", hint: "your own label" },
];

const POSITIONS: { id: BadgePosition; label: string }[] = [
  { id: "top-left", label: "Top left" },
  { id: "top-center", label: "Top center" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-center", label: "Bottom center" },
  { id: "bottom-right", label: "Bottom right" },
];

const PRESET_COLORS = ["#111827", "#1d4ed8", "#7c3aed", "#b45309", "#16a34a", "#be123c"];

function newBadge(type: BadgeType): BadgeSpec {
  return {
    type,
    position: type === "rating" ? "bottom-right" : "top-left",
    scale: 1,
    color: "#111827",
    value: type === "text" ? "REMUX" : type === "new" ? "30" : undefined,
  };
}

export default function OverlaysPage() {
  const qc = useQueryClient();
  const [name, setName] = React.useState("My overlay");
  const [badges, setBadges] = React.useState<BadgeSpec[]>([newBadge("resolution")]);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [sectionId, setSectionId] = React.useState("");
  const [previewSrc, setPreviewSrc] = React.useState<string | null>(null);
  const [applyJobId, setApplyJobId] = React.useState<string | null>(null);
  const [confirmApply, setConfirmApply] = React.useState(false);
  const [confirmRestore, setConfirmRestore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [pickedItem, setPickedItem] = React.useState<MediaItem | null>(null);
  const [previewSearch, setPreviewSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  const { data: sections } = useQuery({
    queryKey: ["sections"],
    queryFn: () => api<LibrarySection[]>("/api/library/sections"),
  });

  const { data: presets } = useQuery({
    queryKey: ["overlay-presets"],
    queryFn: () => api<OverlayPreset[]>("/api/overlays/presets"),
  });

  const { data: status } = useQuery({
    queryKey: ["overlay-status"],
    queryFn: () => api<OverlayStatus>("/api/overlays/status"),
  });

  React.useEffect(() => {
    if (!sectionId && sections?.length) setSectionId(sections[0].id);
  }, [sections, sectionId]);

  const { data: sample } = useQuery({
    queryKey: ["overlay-sample", sectionId],
    queryFn: () => api<MediaItem>(`/api/overlays/sample?sectionId=${sectionId}`),
    enabled: !!sectionId,
    retry: false,
  });

  // The item shown in the preview: whatever the user picked, else the sample.
  const previewItem = pickedItem ?? sample ?? null;

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(previewSearch), 300);
    return () => clearTimeout(t);
  }, [previewSearch]);

  const { data: searchResults } = useQuery({
    queryKey: ["overlay-preview-search", sectionId, debouncedSearch],
    queryFn: () =>
      api<{ items: MediaItem[] }>(
        `/api/library/sections/${sectionId}/items?search=${encodeURIComponent(debouncedSearch)}&limit=8`,
      ),
    enabled: !!sectionId && debouncedSearch.trim().length > 1,
  });

  // Re-render the preview whenever the design or chosen item changes
  const renderPreview = React.useCallback(async () => {
    if (!previewItem?.ratingKey) {
      setError("No poster to preview — pick an item or connect a library.");
      return;
    }
    setError(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/overlays/preview?ratingKey=${previewItem.ratingKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, badges }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Preview failed (${res.status})`);
      }
      const blob = await res.blob();
      setPreviewSrc((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "TimeoutError";
      setError(timedOut ? "Preview timed out — the server may be busy." : (e as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  }, [previewItem?.ratingKey, name, badges]);

  React.useEffect(() => {
    const t = setTimeout(renderPreview, 400);
    return () => clearTimeout(t);
  }, [renderPreview]);

  const savePreset = useMutation({
    mutationFn: () =>
      editingId
        ? api<OverlayPreset>(`/api/overlays/presets/${editingId}`, {
            method: "PUT",
            body: JSON.stringify({ name, badges }),
          })
        : api<OverlayPreset>("/api/overlays/presets", {
            method: "POST",
            body: JSON.stringify({ name, badges }),
          }),
    onSuccess: (preset) => {
      setEditingId(preset.id);
      qc.invalidateQueries({ queryKey: ["overlay-presets"] });
    },
    onError: (e) => setError((e as Error).message),
  });

  const deletePreset = useMutation({
    mutationFn: (id: number) => api(`/api/overlays/presets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["overlay-presets"] });
      setEditingId(null);
    },
  });

  const applyOverlay = useMutation({
    mutationFn: async () => {
      // Applying requires a saved preset — save first if this is a draft.
      let id = editingId;
      if (!id) {
        const created = await api<OverlayPreset>("/api/overlays/presets", {
          method: "POST",
          body: JSON.stringify({ name, badges }),
        });
        id = created.id;
        setEditingId(id);
        qc.invalidateQueries({ queryKey: ["overlay-presets"] });
      }
      return api<{ jobId: string }>("/api/overlays/apply", {
        method: "POST",
        body: JSON.stringify({ presetId: id, sectionId }),
      });
    },
    onSuccess: (data) => {
      setApplyJobId(data.jobId);
      setConfirmApply(false);
    },
    onError: (e) => setError((e as Error).message),
  });

  const restore = useMutation({
    mutationFn: () => api<{ jobId: string }>("/api/overlays/restore", { method: "POST" }),
    onSuccess: (data) => {
      setApplyJobId(data.jobId);
      setConfirmRestore(false);
    },
  });

  const onJobFinished = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["overlay-status"] });
    qc.invalidateQueries({ queryKey: ["items"] });
    void renderPreview();
  }, [qc, renderPreview]);

  const updateBadge = (index: number, patch: Partial<BadgeSpec>) =>
    setBadges((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));

  const sectionName = sections?.find((s) => s.id === sectionId)?.title ?? "this library";

  return (
    <main>
      <Topbar
        title="Overlays"
        actions={
          <div className="flex items-center gap-2">
            {status && status.overlaidCount > 0 && (
              <Button size="sm" variant="outline" onClick={() => setConfirmRestore(true)}>
                <History className="h-4 w-4" /> Restore originals ({status.overlaidCount})
              </Button>
            )}
            <Button size="sm" loading={savePreset.isPending} onClick={() => savePreset.mutate()}>
              <Save className="h-4 w-4" /> {editingId ? "Save preset" : "Save as preset"}
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 p-6 lg:grid-cols-[1fr_420px]">
        {/* Designer */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Badges</CardTitle>
              <CardDescription>
                Badges are burned into the poster. MetaMagic saves each original first, so you can
                always restore — and re-applying never stacks badges on badges.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="preset-name">Preset name</Label>
                <Input
                  id="preset-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="max-w-sm"
                />
              </div>

              <div className="space-y-3">
                {badges.map((badge, i) => (
                  <div
                    key={i}
                    className="space-y-3 rounded-lg border border-border/60 bg-secondary/20 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {BADGE_TYPES.find((t) => t.id === badge.type)?.label ?? badge.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {BADGE_TYPES.find((t) => t.id === badge.type)?.hint}
                        </span>
                      </div>
                      <button
                        onClick={() => setBadges((prev) => prev.filter((_, idx) => idx !== i))}
                        className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        aria-label="Remove badge"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Position</Label>
                        <NativeSelect
                          className="w-full"
                          value={badge.position}
                          onChange={(e) =>
                            updateBadge(i, { position: e.target.value as BadgePosition })
                          }
                        >
                          {POSITIONS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Size</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0.5}
                            max={2}
                            step={0.05}
                            value={badge.scale}
                            onChange={(e) => updateBadge(i, { scale: Number(e.target.value) })}
                            className="flex-1 accent-[hsl(var(--primary))]"
                          />
                          <Input
                            type="number"
                            min={0.5}
                            max={2}
                            step={0.05}
                            value={badge.scale}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (!Number.isNaN(v))
                                updateBadge(i, { scale: Math.min(2, Math.max(0.5, v)) });
                            }}
                            className="h-7 w-20 text-xs"
                          />
                          <span className="text-xs text-muted-foreground">×</span>
                        </div>
                      </div>
                    </div>

                    {(badge.type === "text" || badge.type === "new") && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">
                          {badge.type === "text" ? "Label" : "Days considered new"}
                        </Label>
                        <Input
                          value={badge.value ?? ""}
                          onChange={(e) => updateBadge(i, { value: e.target.value })}
                          className="max-w-xs"
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label className="text-xs">Color</Label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => updateBadge(i, { color: c })}
                            style={{ backgroundColor: c }}
                            className={cn(
                              "h-6 w-6 rounded-full border transition-transform",
                              badge.color.toLowerCase() === c
                                ? "scale-110 border-primary ring-2 ring-primary"
                                : "border-border",
                            )}
                            aria-label={`Color ${c}`}
                          />
                        ))}
                        <ColorPicker
                          value={badge.color}
                          onChange={(color) => updateBadge(i, { color })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {BADGE_TYPES.map((t) => (
                  <Button
                    key={t.id}
                    size="sm"
                    variant="outline"
                    onClick={() => setBadges((prev) => [...prev, newBadge(t.id)])}
                  >
                    <Plus className="h-3.5 w-3.5" /> {t.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Apply</CardTitle>
              <CardDescription>
                Burns this design into every poster in the chosen library that has at least one
                matching badge.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="overlay-section">Library</Label>
                <NativeSelect
                  id="overlay-section"
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                >
                  {sections?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button
                disabled={badges.length === 0 || !sectionId}
                onClick={() => setConfirmApply(true)}
              >
                <Wand2 className="h-4 w-4" /> Apply to {sectionName}
              </Button>
            </CardContent>
          </Card>

          {presets && presets.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Saved presets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {presets.map((p) => (
                  <div
                    key={p.id}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-1.5 text-sm",
                      editingId === p.id && "bg-secondary/60",
                    )}
                  >
                    <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.badges.length} badge{p.badges.length === 1 ? "" : "s"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(p.id);
                        setName(p.name);
                        setBadges(p.badges);
                      }}
                    >
                      Load
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deletePreset.mutate(p.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Live preview */}
        <div className="space-y-3">
          <Card className="sticky top-20">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                Live preview
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={previewLoading}
                  onClick={() => void renderPreview()}
                  title="Refresh preview"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", previewLoading && "animate-spin")} />
                </Button>
              </CardTitle>
              <CardDescription>
                Previewing on{" "}
                <span className="text-foreground/80">{previewItem?.title ?? "…"}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Pick which item to preview on */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Preview on a different title…"
                  value={previewSearch}
                  onChange={(e) => setPreviewSearch(e.target.value)}
                  className="pl-9"
                />
                {debouncedSearch.trim().length > 1 && searchResults && (
                  <div className="absolute z-20 mt-1 max-h-56 w-full space-y-0.5 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
                    {searchResults.items.length === 0 ? (
                      <p className="px-2 py-1.5 text-sm text-muted-foreground">No matches.</p>
                    ) : (
                      searchResults.items.map((it) => (
                        <button
                          key={it.ratingKey}
                          onClick={() => {
                            setPickedItem(it);
                            setPreviewSearch("");
                            setDebouncedSearch("");
                          }}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary/60"
                        >
                          {it.thumb && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imageUrl(it.thumb, 40, 60)}
                              alt=""
                              className="h-9 w-6 rounded object-cover"
                            />
                          )}
                          <span className="flex-1 truncate">
                            {it.title}
                            {it.year ? <span className="text-muted-foreground"> ({it.year})</span> : null}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {error ? (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button size="sm" variant="outline" onClick={() => void renderPreview()}>
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </Button>
                </div>
              ) : previewSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewSrc}
                  alt="Overlay preview"
                  className={cn(
                    "w-full rounded-lg border border-border/60 transition-opacity",
                    previewLoading && "opacity-50",
                  )}
                />
              ) : (
                <Skeleton className="aspect-[2/3] w-full rounded-lg" />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={confirmApply}
        onClose={() => setConfirmApply(false)}
        title={`Apply overlays to ${sectionName}?`}
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Every matching poster in <strong className="text-foreground">{sectionName}</strong> will
            be replaced with an overlaid version in Plex.
          </p>
          <p>
            MetaMagic saves each original poster before touching it, so{" "}
            <strong className="text-foreground">Restore originals</strong> can undo this at any
            time.
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmApply(false)}>
            Cancel
          </Button>
          <Button loading={applyOverlay.isPending} onClick={() => applyOverlay.mutate()}>
            Apply overlays
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={confirmRestore}
        onClose={() => setConfirmRestore(false)}
        title="Restore original posters?"
      >
        <p className="text-sm text-muted-foreground">
          The {status?.overlaidCount ?? 0} poster(s) MetaMagic overlaid will be put back exactly as
          they were, and the saved copies removed.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmRestore(false)}>
            Cancel
          </Button>
          <Button variant="destructive" loading={restore.isPending} onClick={() => restore.mutate()}>
            Restore all
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={!!applyJobId}
        onClose={() => setApplyJobId(null)}
        title="Working"
        className="max-w-2xl"
      >
        {applyJobId && <JobLog jobId={applyJobId} onFinished={onJobFinished} doneLabel="Finished" />}
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={() => setApplyJobId(null)}>
            Close
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
