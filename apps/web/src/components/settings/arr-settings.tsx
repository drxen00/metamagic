"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clapperboard, Tv, XCircle } from "lucide-react";
import type { ArrOptions, ArrSettings } from "@metamagic/shared";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, NativeSelect } from "@/components/ui/input";

type Kind = "radarr" | "sonarr";

function ArrKindCard({ kind, label, icon: Icon }: { kind: Kind; label: string; icon: typeof Tv }) {
  const qc = useQueryClient();
  const [url, setUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [tested, setTested] = React.useState<string | null>(null);

  const { data: settings } = useQuery({
    queryKey: ["arr-settings"],
    queryFn: () => api<ArrSettings>("/api/settings/arr"),
  });
  const cfg = settings?.[kind];
  const configured = cfg?.configured ?? false;

  React.useEffect(() => {
    if (cfg?.url) setUrl((u) => u || cfg.url!);
  }, [cfg?.url]);

  const { data: options } = useQuery({
    queryKey: ["arr-options", kind],
    queryFn: () => api<ArrOptions>(`/api/settings/arr/options?kind=${kind}`),
    enabled: configured,
    retry: false,
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/api/settings/arr", { method: "PUT", body: JSON.stringify({ kind, ...body }) }),
    onSuccess: () => {
      setApiKey("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["arr-settings"] });
      qc.invalidateQueries({ queryKey: ["arr-options", kind] });
    },
    onError: (e) => setError((e as Error).message),
  });

  const test = useMutation({
    mutationFn: () =>
      api<{ version: string }>("/api/settings/arr/test", {
        method: "POST",
        body: JSON.stringify({ kind, url: url.trim() || undefined, apiKey: apiKey.trim() || undefined }),
      }),
    onMutate: () => {
      setError(null);
      setTested(null);
    },
    onSuccess: (r) => setTested(r.version),
    onError: (e) => setError((e as Error).message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {label}
          {configured && <Badge variant="success">connected</Badge>}
        </CardTitle>
        <CardDescription>
          {kind === "radarr"
            ? "Request missing collection movies straight from MetaMagic."
            : "Request missing shows/seasons (used by show automations)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${kind}-url`}>Server URL</Label>
            <Input
              id={`${kind}-url`}
              placeholder={`http://localhost:${kind === "radarr" ? "7878" : "8989"}`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${kind}-key`}>API key</Label>
            <Input
              id={`${kind}-key`}
              type="password"
              placeholder={configured ? "•••••••• (saved)" : "Settings → General in " + label}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        </div>

        {configured && options && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Root folder</Label>
              <NativeSelect
                value={cfg?.rootFolder ?? ""}
                onChange={(e) => save.mutate({ rootFolder: e.target.value })}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {options.rootFolders.map((r) => (
                  <option key={r.path} value={r.path}>
                    {r.path}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Quality profile</Label>
              <NativeSelect
                value={cfg?.qualityProfileId ?? ""}
                onChange={(e) => save.mutate({ qualityProfileId: Number(e.target.value) })}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {options.qualityProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        )}

        {configured && (!cfg?.rootFolder || !cfg?.qualityProfileId) && (
          <p className="text-xs text-warning">
            Pick a root folder and quality profile so requests know where to send downloads.
          </p>
        )}
        {error && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        {tested && !error && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> Connected — {label} v{tested}.
          </p>
        )}

        <div className="flex gap-2">
          <Button
            loading={save.isPending && save.variables?.url !== undefined}
            disabled={!url.trim() || (!apiKey.trim() && !configured)}
            onClick={() => save.mutate({ url: url.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })}
          >
            Save
          </Button>
          <Button
            variant="outline"
            loading={test.isPending}
            disabled={!url.trim() || (!apiKey.trim() && !configured)}
            onClick={() => test.mutate()}
          >
            Test connection
          </Button>
          {configured && (
            <Button
              variant="ghost"
              onClick={() => save.mutate({ url: "", apiKey: "" })}
            >
              Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ArrSettingsCards() {
  return (
    <>
      <ArrKindCard kind="radarr" label="Radarr" icon={Clapperboard} />
      <ArrKindCard kind="sonarr" label="Sonarr" icon={Tv} />
    </>
  );
}
