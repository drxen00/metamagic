"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Layers, Pause, Play, Settings } from "lucide-react";
import type { AutomationPresets, PlexCollection } from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

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

  const invalidate = () => qc.invalidateQueries({ queryKey: ["automation-presets"] });

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
    </div>
  );
}
