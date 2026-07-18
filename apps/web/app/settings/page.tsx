"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Server, Unplug, XCircle } from "lucide-react";
import type { ConnectionStatus, LibrarySection, PlexServerInfo } from "@metamagic/shared";
import { api } from "@/lib/api";
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
              <Label htmlFor="plex-token">X-Plex-Token</Label>
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
      </div>
    </main>
  );
}
