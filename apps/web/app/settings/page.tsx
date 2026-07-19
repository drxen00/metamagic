"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Server, Unplug, XCircle } from "lucide-react";
import type {
  ConnectionStatus,
  IntegrationsStatus,
  JobStatus,
  LibrarySection,
  MediuxMatch,
  PlexServerInfo,
} from "@metamagic/shared";
import { api } from "@/lib/api";
import { imageUrl } from "@/lib/utils";
import { Topbar } from "@/components/shell/topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

interface TestResult {
  server: PlexServerInfo;
  sections: LibrarySection[];
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: connection } = useQuery({
    queryKey: ["connection"],
    queryFn: () => api<ConnectionStatus>("/api/settings/connection"),
  });

  const [url, setUrl] = React.useState("");
  const [token, setToken] = React.useState("");
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);

  React.useEffect(() => {
    if (connection?.url) setUrl(connection.url);
  }, [connection?.url]);

  const test = useMutation({
    mutationFn: () =>
      api<TestResult>("/api/settings/connection/test", {
        method: "POST",
        body: JSON.stringify({ url, token }),
      }),
    onSuccess: setTestResult,
    onMutate: () => setTestResult(null),
  });

  const save = useMutation({
    mutationFn: () =>
      api<ConnectionStatus>("/api/settings/connection", {
        method: "PUT",
        body: JSON.stringify({ url, token }),
      }),
    onSuccess: () => {
      setToken("");
      setTestResult(null);
      qc.invalidateQueries();
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api<ConnectionStatus>("/api/settings/connection", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <main>
      <Topbar title="Settings" />
      <div className="max-w-2xl space-y-6 p-6">
        {connection?.connected && (
          <Card className="border-success/30">
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                  <Server className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="font-semibold">{connection.server?.name ?? "Plex Server"}</p>
                  <p className="text-xs text-muted-foreground">
                    {connection.url} · v{connection.server?.version}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                loading={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                <Unplug className="h-3.5 w-3.5" /> Disconnect
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Plex connection</CardTitle>
            <CardDescription>
              Your token is encrypted at rest with AES-256-GCM and never sent to the browser.{" "}
              <a
                className="text-primary underline-offset-2 hover:underline"
                href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
                target="_blank"
                rel="noreferrer"
              >
                How to find your token
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="plex-url">Server URL</Label>
              <Input
                id="plex-url"
                placeholder="http://192.168.1.10:32400"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plex-token">Plex Token</Label>
              <Input
                id="plex-token"
                type="password"
                placeholder={connection?.connected ? "•••••••• (saved)" : "Your Plex token"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>

            {test.isError && (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4 shrink-0" /> {(test.error as Error).message}
              </p>
            )}
            {save.isError && (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4 shrink-0" /> {(save.error as Error).message}
              </p>
            )}
            {testResult && (
              <div className="space-y-2 rounded-md border border-success/30 bg-success/5 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-success">
                  <CheckCircle2 className="h-4 w-4" /> Found “{testResult.server.name}” (v
                  {testResult.server.version})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {testResult.sections.map((s) => (
                    <Badge key={s.id} variant="secondary">
                      {s.title}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {save.isSuccess && !testResult && (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" /> Connection saved.
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                loading={test.isPending}
                disabled={!url || !token}
                onClick={() => test.mutate()}
              >
                Test connection
              </Button>
              <Button
                loading={save.isPending}
                disabled={!url || !token}
                onClick={() => save.mutate()}
              >
                Save &amp; connect
              </Button>
            </div>
          </CardContent>
        </Card>

        <IntegrationsCard />
        <MediuxImportCard />
        <AccountCard />
      </div>
    </main>
  );
}

function IntegrationsCard() {
  const qc = useQueryClient();
  const [tmdbKey, setTmdbKey] = React.useState("");
  const [mediuxToken, setMediuxToken] = React.useState("");

  const { data: status } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<IntegrationsStatus>("/api/settings/integrations"),
  });

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {};
      if (tmdbKey) body.tmdbApiKey = tmdbKey;
      if (mediuxToken) body.mediuxToken = mediuxToken;
      return api<IntegrationsStatus>("/api/settings/integrations", {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      setTmdbKey("");
      setMediuxToken("");
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          Keys are encrypted at rest. A free TMDb API key unlocks the TMDb tab in the poster
          picker —{" "}
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            get one here
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Label htmlFor="tmdb-key">TMDb API key (v3)</Label>
            {status?.tmdbConfigured && <Badge variant="success">configured</Badge>}
          </div>
          <Input
            id="tmdb-key"
            type="password"
            placeholder={status?.tmdbConfigured ? "•••••••• (saved)" : "TMDb API key"}
            value={tmdbKey}
            onChange={(e) => setTmdbKey(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Label htmlFor="mediux-token">MediUX API token</Label>
            {status?.mediuxTokenConfigured && <Badge variant="success">configured</Badge>}
            <span className="text-xs text-muted-foreground">
              optional — their API is invite-only beta; set import below works without it
            </span>
          </div>
          <Input
            id="mediux-token"
            type="password"
            placeholder={status?.mediuxTokenConfigured ? "•••••••• (saved)" : "MediUX token"}
            value={mediuxToken}
            onChange={(e) => setMediuxToken(e.target.value)}
          />
        </div>
        {save.isError && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" /> {(save.error as Error).message}
          </p>
        )}
        {save.isSuccess && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> Saved.
          </p>
        )}
        <Button
          loading={save.isPending}
          disabled={!tmdbKey && !mediuxToken}
          onClick={() => save.mutate()}
        >
          Save keys
        </Button>
      </CardContent>
    </Card>
  );
}

function MediuxImportCard() {
  const qc = useQueryClient();
  const [yamlText, setYamlText] = React.useState("");
  const [previewResults, setPreviewResults] = React.useState<MediuxMatch[] | null>(null);
  const [mode, setMode] = React.useState<"preview" | "apply" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);

  const preview = useMutation({
    mutationFn: () =>
      api<MediuxMatch[]>("/api/mediux/preview", {
        method: "POST",
        body: JSON.stringify({ yaml: yamlText }),
      }),
    onSuccess: (data) => {
      setPreviewResults(data);
      setMode("preview");
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
  });

  const applyStart = useMutation({
    mutationFn: () =>
      api<{ jobId: string }>("/api/mediux/apply", {
        method: "POST",
        body: JSON.stringify({ yaml: yamlText }),
      }),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setMode("apply");
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
  });

  const { data: job } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<JobStatus<MediuxMatch>>(`/api/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1200 : false),
  });

  const jobRunning = job?.status === "running";
  const jobFinished = job?.status === "done" || job?.status === "error";
  React.useEffect(() => {
    if (jobFinished) {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["provenance"] });
      qc.invalidateQueries({ queryKey: ["children"] });
    }
  }, [jobFinished, qc]);

  const results = mode === "apply" ? (job?.results ?? []) : previewResults;
  const matched = results?.filter((r) => r.ratingKey).length ?? 0;
  const applied = results?.filter((r) => r.applied).length ?? 0;

  const logRef = React.useRef<HTMLDivElement>(null);
  const logLength = job?.log?.length ?? 0;
  React.useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    // Follow the tail unless the user scrolled up to inspect earlier lines
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [logLength]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import a MediUX set</CardTitle>
        <CardDescription>
          On any{" "}
          <a
            href="https://mediux.pro"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            mediux.pro
          </a>{" "}
          set page, hit “Copy YAML” and paste it here. MetaMagic matches titles to your libraries
          by TMDb id and applies posters &amp; backgrounds (locked so refreshes keep them).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <textarea
          value={yamlText}
          onChange={(e) => {
            setYamlText(e.target.value);
            setPreviewResults(null);
            setMode(null);
            setJobId(null);
          }}
          rows={6}
          placeholder={"metadata:\n  \"603692\":\n    url_poster: https://api.mediux.pro/assets/…"}
          className="w-full rounded-md border border-input bg-background/50 px-3 py-2 font-mono text-xs leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        {results && (mode === "preview" || job) && (
          <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              {mode === "apply" ? (
                jobRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    {job?.current ?? "Working…"}
                  </>
                ) : job?.status === "error" ? (
                  <>
                    <XCircle className="h-4 w-4 text-destructive" /> {job.error}
                  </>
                ) : (
                  `Applied ${applied} of ${results.length} entries`
                )
              ) : (
                `${matched} of ${results.length} entries match your libraries`
              )}
            </p>

            {mode === "apply" && job && job.log.length > 0 && (
              <div
                ref={logRef}
                className="max-h-44 overflow-y-auto rounded-md bg-background/60 p-2 font-mono text-xs leading-relaxed"
              >
                {job.log.map((line, i) => (
                  <p
                    key={i}
                    className={
                      line.startsWith("✗")
                        ? "text-destructive"
                        : line.startsWith("✓")
                          ? "text-success"
                          : "text-muted-foreground"
                    }
                  >
                    {line}
                  </p>
                ))}
              </div>
            )}
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {results.map((r) => (
                <div key={r.id} className="flex items-center gap-2.5 text-sm">
                  {r.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={/^https?:\/\//.test(r.thumb) ? r.thumb : imageUrl(r.thumb, 40, 60)}
                      alt=""
                      className="h-9 w-6 rounded object-cover"
                    />
                  ) : (
                    <span className="h-9 w-6 rounded bg-secondary" />
                  )}
                  <span className="flex-1 truncate">
                    {r.title ?? `id ${r.id}`}
                    {!r.ratingKey && r.kind === "item" && r.title && (
                      <span className="ml-1.5 text-xs text-muted-foreground">(not downloaded)</span>
                    )}
                    {r.kind === "collection" && (
                      <Badge variant="outline" className="ml-1.5">
                        collection
                      </Badge>
                    )}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {[
                        r.hasPoster && "poster",
                        r.hasBackground && "background",
                        r.seasonCount > 0 &&
                          `${mode === "apply" ? `${r.appliedSeasons ?? 0}/` : ""}${r.seasonCount} season${r.seasonCount === 1 ? "" : "s"}`,
                        r.episodeCount > 0 &&
                          `${mode === "apply" ? `${r.appliedEpisodes ?? 0}/` : ""}${r.episodeCount} card${r.episodeCount === 1 ? "" : "s"}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {mode === "apply" ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      {r.applied && <CheckCircle2 className="h-4 w-4 text-success" />}
                      {r.error && (
                        <span
                          className="max-w-48 truncate text-xs text-destructive"
                          title={r.error}
                        >
                          {r.error}
                        </span>
                      )}
                    </span>
                  ) : r.ratingKey ? (
                    <Badge variant="success">match</Badge>
                  ) : (
                    <Badge variant="outline">
                      {r.kind === "collection" ? "no matching collection" : "not in library"}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            loading={preview.isPending}
            disabled={!yamlText.trim() || preview.isPending || jobRunning}
            onClick={() => preview.mutate()}
          >
            Preview matches
          </Button>
          <Button
            loading={applyStart.isPending || jobRunning}
            disabled={
              !yamlText.trim() ||
              applyStart.isPending ||
              jobRunning ||
              (mode === "preview" && matched === 0)
            }
            onClick={() => applyStart.mutate()}
          >
            Apply to library
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => {
      if (next !== confirm) throw new Error("New passwords don't match.");
      return api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
    },
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Change the password you use to sign in to MetaMagic.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pw-current">Current password</Label>
          <Input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pw-next">New password</Label>
            <Input
              id="pw-next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-confirm">Confirm new password</Label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        {error && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        {change.isSuccess && !error && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> Password changed.
          </p>
        )}
        <Button
          loading={change.isPending}
          disabled={!current || !next || !confirm}
          onClick={() => change.mutate()}
        >
          Change password
        </Button>
      </CardContent>
    </Card>
  );
}
