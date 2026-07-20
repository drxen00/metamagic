"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Search, Tag, XCircle } from "lucide-react";
import type {
  KeywordOption,
  LibrarySection,
  Rule,
  RuleEvaluation,
  RuleInput,
  RuleSource,
  TmdbCollectionOption,
} from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, NativeSelect } from "@/components/ui/input";

interface RuleDialogProps {
  open: boolean;
  onClose: () => void;
  /** Existing rule to edit, or undefined to create */
  rule?: Rule;
  /** Pre-fill from a discovery suggestion */
  initial?: Partial<RuleInput>;
}

type SourceTab = "collection" | "keyword";

export function RuleDialog({ open, onClose, rule, initial }: RuleDialogProps) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [collectionTitle, setCollectionTitle] = React.useState("");
  const [sectionId, setSectionId] = React.useState("");
  const [source, setSource] = React.useState<RuleSource | null>(null);
  const [sourceTab, setSourceTab] = React.useState<SourceTab>("collection");
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [schedule, setSchedule] = React.useState<RuleInput["schedule"]>("daily");
  const [removeStrays, setRemoveStrays] = React.useState(false);
  const [requireApproval, setRequireApproval] = React.useState(false);
  const [mediuxYaml, setMediuxYaml] = React.useState("");
  const [preview, setPreview] = React.useState<RuleEvaluation | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const { data: sections } = useQuery({
    queryKey: ["sections"],
    queryFn: () => api<LibrarySection[]>("/api/library/sections"),
    enabled: open,
  });

  // Seed the form when opened
  React.useEffect(() => {
    if (!open) return;
    const base = rule ?? initial;
    setName(base?.name ?? "");
    setCollectionTitle(base?.collectionTitle ?? "");
    setSectionId(base?.sectionId ?? "");
    setSource(base?.source ?? null);
    setSourceTab(base?.source?.kind === "tmdb-keyword" ? "keyword" : "collection");
    setSchedule(base?.schedule ?? "daily");
    setRemoveStrays(base?.removeStrays ?? false);
    setRequireApproval(base?.requireApproval ?? false);
    setMediuxYaml(base?.mediuxYaml ?? "");
    setPreview(null);
    setError(null);
    setQuery("");
  }, [open, rule, initial]);

  React.useEffect(() => {
    if (!sectionId && sections?.length) setSectionId(sections[0].id);
  }, [sections, sectionId]);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: collectionOptions } = useQuery({
    queryKey: ["tmdb-collections", debounced],
    queryFn: () =>
      api<TmdbCollectionOption[]>(`/api/tmdb/collections?q=${encodeURIComponent(debounced)}`),
    enabled: open && sourceTab === "collection" && debounced.trim().length > 1,
  });

  const { data: keywordOptions } = useQuery({
    queryKey: ["tmdb-keywords", debounced],
    queryFn: () => api<KeywordOption[]>(`/api/tmdb/keywords?q=${encodeURIComponent(debounced)}`),
    enabled: open && sourceTab === "keyword" && debounced.trim().length > 1,
  });

  const draft = (): RuleInput | null => {
    if (!source || !sectionId || !name.trim() || !collectionTitle.trim()) return null;
    return {
      name: name.trim(),
      enabled: rule?.enabled ?? true,
      requireApproval,
      sectionId,
      source,
      collectionTitle: collectionTitle.trim(),
      collectionRatingKey: rule?.collectionRatingKey,
      addMatching: true,
      removeStrays,
      mediuxYaml: mediuxYaml.trim() || undefined,
      schedule,
    };
  };

  const runPreview = useMutation({
    mutationFn: () => {
      const d = draft();
      if (!d) throw new Error("Fill in the name, collection and source first.");
      return api<RuleEvaluation>("/api/rules/preview", {
        method: "POST",
        body: JSON.stringify(d),
      });
    },
    onSuccess: setPreview,
    onError: (e) => setError((e as Error).message),
    onMutate: () => setError(null),
  });

  const save = useMutation({
    mutationFn: () => {
      const d = draft();
      if (!d) throw new Error("Fill in the name, collection and source first.");
      return rule
        ? api<Rule>(`/api/rules/${rule.id}`, { method: "PUT", body: JSON.stringify(d) })
        : api<Rule>("/api/rules", { method: "POST", body: JSON.stringify(d) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  const pickSource = (s: RuleSource) => {
    setSource(s);
    setPreview(null);
    if (!name.trim()) {
      setName(s.kind === "tmdb-collection" ? s.tmdbCollectionName : `${s.keywordName} collection`);
    }
    if (!collectionTitle.trim()) {
      setCollectionTitle(
        s.kind === "tmdb-collection" ? s.tmdbCollectionName : `${s.keywordName} collection`,
      );
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={rule ? `Edit rule — ${rule.name}` : "New automation rule"}
      className="w-[94vw] max-w-3xl"
    >
      <div className="max-h-[76vh] space-y-4 overflow-y-auto pr-1">
        {/* Source */}
        <div className="space-y-2">
          <Label>What should go in the collection?</Label>
          <div className="flex gap-2">
            {(
              [
                { id: "collection", label: "TMDb franchise" },
                { id: "keyword", label: "Keyword / character" },
              ] as { id: SourceTab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setSourceTab(t.id);
                  setQuery("");
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  sourceTab === t.id
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {source && (
            <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
              {source.kind === "tmdb-collection" ? (
                <Plus className="h-4 w-4 text-primary" />
              ) : (
                <Tag className="h-4 w-4 text-primary" />
              )}
              <span className="flex-1 truncate">
                {source.kind === "tmdb-collection"
                  ? source.tmdbCollectionName
                  : `Keyword: ${source.keywordName}`}
              </span>
              <button
                onClick={() => setSource(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                change
              </button>
            </div>
          )}

          {!source && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={
                    sourceTab === "collection"
                      ? "Search franchises — e.g. The Lord of the Rings"
                      : "Search keywords — e.g. scooby-doo, superhero"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                {sourceTab === "collection"
                  ? collectionOptions?.map((o) => (
                      <button
                        key={o.id}
                        onClick={() =>
                          pickSource({
                            kind: "tmdb-collection",
                            tmdbCollectionId: o.id,
                            tmdbCollectionName: o.name,
                          })
                        }
                        className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary/60"
                      >
                        {o.posterUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={o.posterUrl} alt="" className="h-12 w-8 rounded object-cover" />
                        ) : (
                          <span className="h-12 w-8 rounded bg-secondary" />
                        )}
                        <span className="flex-1 truncate">{o.name}</span>
                        <Plus className="h-4 w-4 text-primary" />
                      </button>
                    ))
                  : keywordOptions?.map((k) => (
                      <button
                        key={k.id}
                        onClick={() =>
                          pickSource({
                            kind: "tmdb-keyword",
                            keywordId: k.id,
                            keywordName: k.name,
                          })
                        }
                        className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary/60"
                      >
                        <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{k.name}</span>
                        <Plus className="h-4 w-4 text-primary" />
                      </button>
                    ))}
              </div>
            </>
          )}
        </div>

        {/* Target */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Rule name</Label>
            <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-collection">Plex collection</Label>
            <Input
              id="rule-collection"
              value={collectionTitle}
              onChange={(e) => setCollectionTitle(e.target.value)}
              placeholder="Created if it doesn't exist"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-section">Library</Label>
            <NativeSelect
              id="rule-section"
              className="w-full"
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
          <div className="space-y-1.5">
            <Label htmlFor="rule-schedule">Schedule</Label>
            <NativeSelect
              id="rule-schedule"
              className="w-full"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as RuleInput["schedule"])}
            >
              <option value="manual">Manual only</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </NativeSelect>
          </div>
        </div>

        {/* Options */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setRemoveStrays((v) => !v)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              removeStrays
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            Remove items that don’t match
          </button>
          <button
            onClick={() => setRequireApproval((v) => !v)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              requireApproval
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            Ask before applying
          </button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-yaml">
            MediUX YAML <span className="text-muted-foreground">(optional)</span>
          </Label>
          <textarea
            id="rule-yaml"
            rows={3}
            value={mediuxYaml}
            onChange={(e) => setMediuxYaml(e.target.value)}
            placeholder="Paste a set's YAML to re-apply its artwork whenever this rule adds something"
            className="w-full rounded-md border border-input bg-background/50 px-3 py-2 font-mono text-xs leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {/* Preview */}
        {preview && (
          <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
            <p className="text-sm font-medium">
              {preview.toAdd.length} to add · {preview.toRemove.length} to remove ·{" "}
              {preview.missingFromLibrary.length} not in library
            </p>
            <div className="max-h-48 space-y-1 overflow-y-auto pr-1 text-sm">
              {preview.toAdd.map((c) => (
                <p key={`a-${c.ratingKey}`} className="flex items-center gap-1.5 text-success">
                  <Plus className="h-3.5 w-3.5 shrink-0" /> {c.title}
                  {c.year ? ` (${c.year})` : ""}
                </p>
              ))}
              {preview.toRemove.map((c) => (
                <p key={`r-${c.ratingKey}`} className="flex items-center gap-1.5 text-destructive">
                  <Minus className="h-3.5 w-3.5 shrink-0" /> {c.title}
                  {c.year ? ` (${c.year})` : ""}
                </p>
              ))}
              {preview.missingFromLibrary.slice(0, 20).map((m) => (
                <p key={`m-${m.tmdbId}`} className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="w-3.5 shrink-0 text-center">·</span> {m.title}
                  {m.year ? ` (${m.year})` : ""} — not downloaded
                </p>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            loading={runPreview.isPending}
            disabled={!draft() || runPreview.isPending}
            onClick={() => runPreview.mutate()}
          >
            Preview
          </Button>
          <Button loading={save.isPending} disabled={!draft()} onClick={() => save.mutate()}>
            {rule ? "Save changes" : "Create rule"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
