"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  FolderPlus,
  Layers,
  Pause,
  Play,
  Plus,
  RotateCw,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import type { AutomationPresets, PlexCollection, StudioAutomation } from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { JobLog } from "./job-log";

/** Small "Run now" button + progress dialog, shared by the preset cards. */
function useRunNow(path: string, invalidate: () => void) {
  const [jobId, setJobId] = React.useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api<{ jobId: string }>(path, { method: "POST" }),
    onSuccess: (r) => setJobId(r.jobId),
  });
  const dialog = (title: string) => (
    <Dialog open={!!jobId} onClose={() => setJobId(null)} title={title} className="max-w-2xl">
      {jobId && <JobLog jobId={jobId} onFinished={invalidate} doneLabel="Finished" />}
      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={() => setJobId(null)}>
          Close
        </Button>
      </div>
    </Dialog>
  );
  const button = (
    <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate()}>
      <RotateCw className="h-3.5 w-3.5" /> Run now
    </Button>
  );
  return { button, dialog };
}

/**
 * The predefined "automatic" automations — toggle-and-forget collection
 * automation, with a settings cog for the few knobs each one needs. The
 * Collections page stays the place for hand-polished collections; this is where
 * the automatic ones live.
 */
export function PresetAutomations() {
  const qc = useQueryClient();
  const [showFranchise, setShowFranchise] = React.useState(false);
  const [showAutoAdd, setShowAutoAdd] = React.useState(false);

  const { data } = useQuery({
    queryKey: ["automation-presets"],
    queryFn: () => api<AutomationPresets>("/api/automations/presets"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["automation-presets"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
  };

  const franchiseRun = useRunNow("/api/automations/franchise/run", invalidate);
  const autoAddRun = useRunNow("/api/automations/auto-add/run", invalidate);

  const saveFranchise = useMutation({
    mutationFn: (body: { enabled: boolean; minMovies: number }) =>
      api("/api/automations/franchise", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });

  const saveAutoAdd = useMutation({
    mutationFn: (body: { enabled: boolean; excludeRatingKeys: string[] }) =>
      api("/api/automations/auto-add", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });

  // Only needed when picking which collections to exclude.
  const { data: collections } = useQuery({
    queryKey: ["collections"],
    queryFn: () => api<PlexCollection[]>("/api/collections"),
    enabled: showAutoAdd,
  });

  const franchise = data?.franchise ?? { enabled: false, minMovies: 2 };
  const autoAdd = data?.autoAdd ?? { enabled: false, excludeRatingKeys: [] };
  const excluded = new Set(autoAdd.excludeRatingKeys);

  const toggleExcluded = (ratingKey: string) => {
    const next = new Set(excluded);
    if (next.has(ratingKey)) next.delete(ratingKey);
    else next.add(ratingKey);
    saveAutoAdd.mutate({ enabled: autoAdd.enabled, excludeRatingKeys: [...next] });
  };

  return (
    <div className="space-y-4">
      {/* Franchise auto-create */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FolderPlus className="h-4 w-4 text-primary" /> Auto-create franchise collections
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                As new movies arrive, automatically create a Plex collection for any TMDb franchise
                you own films from — no need to know in advance. Refine and re-poster them later on
                the Collections page.
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5">
              {franchiseRun.button}
              <Button
                variant={franchise.enabled ? "default" : "outline"}
                loading={saveFranchise.isPending}
                onClick={() => saveFranchise.mutate({ ...franchise, enabled: !franchise.enabled })}
              >
                {franchise.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {franchise.enabled ? "On" : "Off"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Settings"
                onClick={() => setShowFranchise((s) => !s)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        {showFranchise && (
          <CardContent>
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-secondary/20 p-3">
              <Label className="text-xs">Minimum films owned to create a collection</Label>
              <Input
                type="number"
                min={1}
                max={20}
                defaultValue={franchise.minMovies}
                onBlur={(e) => {
                  const minMovies = Math.min(20, Math.max(1, Number(e.target.value) || 1));
                  if (minMovies !== franchise.minMovies)
                    saveFranchise.mutate({ enabled: franchise.enabled, minMovies });
                }}
                className="h-8 w-20"
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Auto-add to existing */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" /> Auto-add new movies to existing collections
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                When a movie that belongs to a collection you already have shows up in Plex, add it
                automatically. Exclude any collections you curate by hand.
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5">
              {autoAddRun.button}
              <Button
                variant={autoAdd.enabled ? "default" : "outline"}
                loading={saveAutoAdd.isPending && !saveAutoAdd.variables?.excludeRatingKeys}
                onClick={() =>
                  saveAutoAdd.mutate({ ...autoAdd, enabled: !autoAdd.enabled })
                }
              >
                {autoAdd.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {autoAdd.enabled ? "On" : "Off"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Settings"
                onClick={() => setShowAutoAdd((s) => !s)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        {showAutoAdd && (
          <CardContent>
            <div className="space-y-2 rounded-md border border-border/60 bg-secondary/20 p-3">
              <p className="text-xs text-muted-foreground">
                Collections to leave untouched{excluded.size > 0 ? ` · ${excluded.size} excluded` : ""}:
              </p>
              {!collections ? (
                <p className="text-xs text-muted-foreground">Loading collections…</p>
              ) : collections.length === 0 ? (
                <p className="text-xs text-muted-foreground">No collections yet.</p>
              ) : (
                <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
                  {collections.map((c) => (
                    <label
                      key={c.ratingKey}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-secondary/60"
                    >
                      <input
                        type="checkbox"
                        checked={excluded.has(c.ratingKey)}
                        onChange={() => toggleExcluded(c.ratingKey)}
                        className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                      />
                      <span className="truncate">{c.title}</span>
                      {c.sectionTitle && (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {c.sectionTitle}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      <StudioCard />

      {franchiseRun.dialog("Creating franchise collections")}
      {autoAddRun.dialog("Adding to existing collections")}
    </div>
  );
}

/** Auto-create/maintain collections of movies by studio (TMDb company). */
function StudioCard() {
  const qc = useQueryClient();
  const [show, setShow] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");

  const { data } = useQuery({
    queryKey: ["automation-presets"],
    queryFn: () => api<AutomationPresets>("/api/automations/presets"),
  });
  const studio = data?.studio ?? { enabled: false, studios: [] };

  const save = useMutation({
    mutationFn: (body: StudioAutomation) =>
      api("/api/automations/studio", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automation-presets"] }),
  });

  const studioRun = useRunNow("/api/automations/studio/run", () => {
    qc.invalidateQueries({ queryKey: ["automation-presets"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
  });

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: companies } = useQuery({
    queryKey: ["tmdb-companies", debounced],
    queryFn: () => api<{ id: number; name: string }[]>(`/api/tmdb/companies?q=${encodeURIComponent(debounced)}`),
    enabled: show && debounced.trim().length > 1,
  });

  const addStudio = (c: { id: number; name: string }) => {
    if (studio.studios.some((s) => s.companyId === c.id)) return;
    save.mutate({
      ...studio,
      studios: [...studio.studios, { companyId: c.id, name: c.name, minMovies: 3 }],
    });
    setQuery("");
    setDebounced("");
  };

  const removeStudio = (companyId: number) =>
    save.mutate({ ...studio, studios: studio.studios.filter((s) => s.companyId !== companyId) });

  const setMin = (companyId: number, minMovies: number) =>
    save.mutate({
      ...studio,
      studios: studio.studios.map((s) => (s.companyId === companyId ? { ...s, minMovies } : s)),
    });

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Studio collections
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              Keep a collection of everything you own from a studio — e.g. DreamWorks, A24, Pixar.
              MetaMagic adds new arrivals from each studio automatically.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            {studioRun.button}
            <Button
              variant={studio.enabled ? "default" : "outline"}
              loading={save.isPending && save.variables?.enabled !== studio.enabled}
              onClick={() => save.mutate({ ...studio, enabled: !studio.enabled })}
            >
              {studio.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {studio.enabled ? "On" : "Off"}
            </Button>
            <Button variant="ghost" size="icon" title="Studios" onClick={() => setShow((s) => !s)}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      {show && (
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Add a studio… (e.g. DreamWorks)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
            {debounced.trim().length > 1 && companies && companies.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-56 w-full space-y-0.5 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
                {companies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => addStudio(c)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary/60"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {studio.studios.length === 0 ? (
            <p className="text-xs text-muted-foreground">No studios yet — search above to add one.</p>
          ) : (
            <div className="space-y-1.5">
              {studio.studios.map((s) => (
                <div
                  key={s.companyId}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-secondary/20 p-2.5"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Min films
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      defaultValue={s.minMovies}
                      onBlur={(e) => {
                        const v = Math.min(50, Math.max(1, Number(e.target.value) || 1));
                        if (v !== s.minMovies) setMin(s.companyId, v);
                      }}
                      className="h-7 w-16"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Remove studio"
                    onClick={() => removeStudio(s.companyId)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
    {studioRun.dialog("Building studio collections")}
    </>
  );
}
