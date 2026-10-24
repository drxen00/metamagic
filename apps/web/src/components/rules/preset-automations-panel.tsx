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
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import type {
  ActorAutomation,
  ActorSuggestion,
  ActorSuggestions,
  JobStatus,
  AutomationPresets,
  CompanyOption,
  PersonOption,
  PlexCollection,
  StudioAutomation,
} from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, NativeSelect } from "@/components/ui/input";
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

      <ActorCard />

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

  const { data: companies, isFetching } = useQuery({
    queryKey: ["tmdb-companies", debounced],
    queryFn: () =>
      api<CompanyOption[]>(`/api/tmdb/companies?q=${encodeURIComponent(debounced)}`),
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
            {debounced.trim().length > 1 && (isFetching || companies) ? (
              <div className="absolute z-20 mt-1 max-h-80 w-full space-y-0.5 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
                {!companies && isFetching ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">Searching studios…</p>
                ) : (
                  companies?.map((c) => {
                    const added = studio.studios.some((s) => s.companyId === c.id);
                    return (
                      <button
                        key={c.id}
                        disabled={added}
                        onClick={() => addStudio(c)}
                        className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary/60 disabled:opacity-40"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary/60">
                          {c.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.logoUrl} alt="" className="max-h-6 max-w-[1.9rem] object-contain" />
                          ) : (
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{c.name}</span>
                            {c.originCountry && (
                              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {c.originCountry}
                              </span>
                            )}
                          </span>
                          {(c.ownedCount !== undefined || c.movieCount !== undefined) && (
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                              <span
                                className={cn(
                                  "font-medium",
                                  (c.ownedCount ?? 0) > 0 ? "text-primary" : "text-muted-foreground",
                                )}
                              >
                                {c.ownedCount ?? 0} in your library
                              </span>
                              {c.movieCount !== undefined && (
                                <span className="text-muted-foreground">· {c.movieCount} on TMDb</span>
                              )}
                            </span>
                          )}
                        </span>
                        {added ? (
                          <span className="shrink-0 text-[10px] font-medium uppercase text-muted-foreground">
                            added
                          </span>
                        ) : (
                          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    );
                  })
                )}
                {companies && companies.length === 0 && !isFetching && (
                  <p className="px-2 py-2 text-xs text-muted-foreground">No studios matched.</p>
                )}
              </div>
            ) : null}
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

/** What counts as a "main character" role, by TMDb billing position. */
const BILLING_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Top-billed only" },
  { value: 3, label: "Lead roles (top 3)" },
  { value: 5, label: "Main cast (top 5)" },
  { value: 0, label: "Any role" },
];

/** Auto-create/maintain collections of an actor's lead-role movies. */
function ActorCard() {
  const qc = useQueryClient();
  const [show, setShow] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");

  const { data } = useQuery({
    queryKey: ["automation-presets"],
    queryFn: () => api<AutomationPresets>("/api/automations/presets"),
  });
  const actor: ActorAutomation = data?.actor ?? { enabled: false, actors: [] };

  const save = useMutation({
    mutationFn: (body: ActorAutomation) =>
      api("/api/automations/actor", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automation-presets"] }),
  });

  const actorRun = useRunNow("/api/automations/actor/run", () => {
    qc.invalidateQueries({ queryKey: ["automation-presets"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
  });

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: people, isFetching } = useQuery({
    queryKey: ["tmdb-people", debounced],
    queryFn: () => api<PersonOption[]>(`/api/tmdb/people?q=${encodeURIComponent(debounced)}`),
    enabled: show && debounced.trim().length > 1,
  });

  const addActor = (p: PersonOption) => {
    if (actor.actors.some((a) => a.personId === p.id)) return;
    save.mutate({
      ...actor,
      actors: [
        ...actor.actors,
        { personId: p.id, name: p.name, minMovies: 3, maxBilling: 3, profilePath: p.profilePath },
      ],
    });
    setQuery("");
    setDebounced("");
  };

  // ---- Suggestions: actors with several lead roles in the library ----
  const [scanJobId, setScanJobId] = React.useState<string | null>(null);
  const [minLeads, setMinLeads] = React.useState(3);
  const { data: suggested } = useQuery({
    queryKey: ["actor-suggestions"],
    queryFn: () => api<ActorSuggestions>("/api/automations/actor/suggestions"),
  });
  const scan = useMutation({
    mutationFn: () =>
      api<{ jobId: string }>("/api/automations/actor/suggestions/scan", { method: "POST" }),
    onSuccess: (r) => setScanJobId(r.jobId),
  });
  const { data: scanJob } = useQuery({
    queryKey: ["job", scanJobId],
    queryFn: () => api<JobStatus<ActorSuggestion>>(`/api/jobs/${scanJobId}`),
    enabled: !!scanJobId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });
  const scanning = scan.isPending || scanJob?.status === "running";
  React.useEffect(() => {
    if (scanJob && scanJob.status !== "running") {
      qc.invalidateQueries({ queryKey: ["actor-suggestions"] });
    }
  }, [scanJob, qc]);

  const configuredIds = new Set(actor.actors.map((a) => a.personId));
  const suggestions = (suggested?.suggestions ?? []).filter(
    (s) => !configuredIds.has(s.personId) && s.leadCount >= minLeads,
  );

  const addSuggestions = (list: ActorSuggestion[]) => {
    const fresh = list.filter((s) => !configuredIds.has(s.personId));
    if (fresh.length === 0) return;
    save.mutate({
      ...actor,
      actors: [
        ...actor.actors,
        ...fresh.map((s) => ({
          personId: s.personId,
          name: s.name,
          // Never require more films than they actually lead, or it'd never build.
          minMovies: Math.min(3, s.leadCount),
          maxBilling: 3,
          profilePath: s.profilePath,
        })),
      ],
    });
  };

  const removeActor = (personId: number) =>
    save.mutate({ ...actor, actors: actor.actors.filter((a) => a.personId !== personId) });

  const update = (personId: number, patch: { minMovies?: number; maxBilling?: number }) =>
    save.mutate({
      ...actor,
      actors: actor.actors.map((a) => (a.personId === personId ? { ...a, ...patch } : a)),
    });

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-primary" /> Actor collections
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                Keep a collection of the movies you own where an actor plays a main character —
                e.g. Ryan Gosling, Tom Hanks. Cameos and bit parts are left out, new arrivals are
                added automatically, and new collections get the actor’s portrait as their poster.
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5">
              {suggestions.length > 0 && !show && (
                <Button size="sm" variant="ghost" onClick={() => setShow(true)}>
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> {suggestions.length} suggested
                </Button>
              )}
              {actorRun.button}
              <Button
                variant={actor.enabled ? "default" : "outline"}
                loading={save.isPending && save.variables?.enabled !== actor.enabled}
                onClick={() => save.mutate({ ...actor, enabled: !actor.enabled })}
              >
                {actor.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {actor.enabled ? "On" : "Off"}
              </Button>
              <Button variant="ghost" size="icon" title="Actors" onClick={() => setShow((s) => !s)}>
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
                placeholder="Add an actor… (e.g. Ryan Gosling)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
              {debounced.trim().length > 1 && (isFetching || people) ? (
                <div className="absolute z-20 mt-1 max-h-80 w-full space-y-0.5 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
                  {!people && isFetching ? (
                    <p className="px-2 py-2 text-xs text-muted-foreground">Searching actors…</p>
                  ) : (
                    people?.map((p) => {
                      const added = actor.actors.some((a) => a.personId === p.id);
                      return (
                        <button
                          key={p.id}
                          disabled={added}
                          onClick={() => addActor(p)}
                          className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary/60 disabled:opacity-40"
                        >
                          <span className="flex h-11 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary/60">
                            {p.profileUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.profileUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <UserRound className="h-4 w-4 text-muted-foreground" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{p.name}</span>
                            {p.knownFor && p.knownFor.length > 0 && (
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {p.knownFor.join(" · ")}
                              </span>
                            )}
                            {p.ownedCount !== undefined && (
                              <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                                <span
                                  className={cn(
                                    "font-medium",
                                    (p.ownedLeadCount ?? 0) > 0
                                      ? "text-primary"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {p.ownedLeadCount ?? 0} lead role{p.ownedLeadCount === 1 ? "" : "s"} in your library
                                </span>
                                <span className="text-muted-foreground">
                                  · {p.ownedCount} film{p.ownedCount === 1 ? "" : "s"} total
                                </span>
                              </span>
                            )}
                          </span>
                          {added ? (
                            <span className="shrink-0 text-[10px] font-medium uppercase text-muted-foreground">
                              added
                            </span>
                          ) : (
                            <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                        </button>
                      );
                    })
                  )}
                  {people && people.length === 0 && !isFetching && (
                    <p className="px-2 py-2 text-xs text-muted-foreground">No actors matched.</p>
                  )}
                </div>
              ) : null}
            </div>

            {actor.actors.length === 0 ? (
              <p className="text-xs text-muted-foreground">No actors yet — search above to add one.</p>
            ) : (
              <div className="space-y-1.5">
                {actor.actors.map((a) => (
                  <div
                    key={a.personId}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-secondary/20 p-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                    <NativeSelect
                      value={a.maxBilling}
                      onChange={(e) => update(a.personId, { maxBilling: Number(e.target.value) })}
                      className="h-7 w-auto text-xs"
                      title="Which roles count"
                    >
                      {BILLING_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </NativeSelect>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Min films
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        defaultValue={a.minMovies}
                        onBlur={(e) => {
                          const v = Math.min(50, Math.max(1, Number(e.target.value) || 1));
                          if (v !== a.minMovies) update(a.personId, { minMovies: v });
                        }}
                        className="h-7 w-16"
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Remove actor"
                      onClick={() => removeActor(a.personId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Suggested from your library
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {scanning
                      ? (scanJob?.current ?? "Starting scan…")
                      : suggested?.scannedAt
                        ? `Actors who lead several of your movies — last scanned ${new Date(
                            suggested.scannedAt,
                          ).toLocaleDateString()}.`
                        : "Scan your movies to find actors who lead several of them."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Min lead roles
                    <Input
                      type="number"
                      min={2}
                      max={20}
                      value={minLeads}
                      onChange={(e) =>
                        setMinLeads(Math.min(20, Math.max(2, Number(e.target.value) || 2)))
                      }
                      className="h-7 w-14"
                    />
                  </label>
                  <Button size="sm" variant="outline" loading={scanning} onClick={() => scan.mutate()}>
                    <Search className="h-3.5 w-3.5" />
                    {suggested?.scannedAt ? "Rescan" : "Scan library"}
                  </Button>
                </div>
              </div>

              {scanJob?.status === "error" && (
                <p className="text-xs text-destructive">{scanJob.error}</p>
              )}

              {suggested?.scannedAt && !scanning && suggestions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No new suggestions at {minLeads}+ lead roles — everyone who qualifies is already
                  added. Try lowering the minimum.
                </p>
              )}

              {suggestions.length > 0 && (
                <>
                  <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
                    {suggestions.map((s) => (
                      <div
                        key={s.personId}
                        className="flex items-center gap-2.5 rounded-md border border-border/60 bg-secondary/10 p-2"
                      >
                        <span className="flex h-11 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary/60">
                          {s.profileUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.profileUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <UserRound className="h-4 w-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{s.name}</span>
                            <span className="shrink-0 text-xs font-medium text-primary">
                              {s.leadCount} lead roles
                            </span>
                          </span>
                          <span
                            className="block truncate text-[11px] text-muted-foreground"
                            title={s.films.map((f) => f.title).join(", ")}
                          >
                            {s.films.map((f) => f.title).join(" · ")}
                          </span>
                          {s.existingCollection && (
                            <span className="block text-[11px] text-muted-foreground">
                              You have a “{s.existingCollection}” collection — adding keeps it synced.
                            </span>
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={save.isPending}
                          onClick={() => addSuggestions([s])}
                        >
                          <Plus className="h-3.5 w-3.5" /> Add
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      {actor.enabled
                        ? "Added actors are built on the next sweep — or hit Run now."
                        : "Turn the automation On (or hit Run now) to build the collections."}
                    </p>
                    {suggestions.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={save.isPending}
                        onClick={() => addSuggestions(suggestions)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Add all {suggestions.length}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Roles are judged by TMDb’s billing order. Removing an actor here stops maintaining
              their collection — it doesn’t delete it.
            </p>
          </CardContent>
        )}
      </Card>
      {actorRun.dialog("Building actor collections")}
    </>
  );
}
