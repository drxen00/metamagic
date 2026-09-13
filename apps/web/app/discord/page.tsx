"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageSquare, XCircle } from "lucide-react";
import type { DiscordEvents, DiscordSettings } from "@metamagic/shared";
import { api } from "@/lib/api";
import { Topbar } from "@/components/shell/topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

const EVENT_ROWS: { key: keyof DiscordEvents; label: string; hint: string }[] = [
  { key: "rules", label: "Rule runs", hint: "Scheduled or manual rules that changed something" },
  { key: "mediuxSync", label: "MediUX auto-sync", hint: "When tracked collections/shows sync, and what triggered it" },
  { key: "mediuxApply", label: "MediUX set applied", hint: "When you apply a MediUX set from a picker" },
  { key: "collections", label: "Collection changes", hint: "Collections created, updated, or deleted" },
  { key: "overlays", label: "Overlays", hint: "Overlay apply and restore" },
  { key: "artwork", label: "Poster & metadata changes", hint: "Poster/background updates and metadata edits" },
];

export default function DiscordPage() {
  const qc = useQueryClient();
  const [webhook, setWebhook] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["discord"],
    queryFn: () => api<DiscordSettings>("/api/settings/discord"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["discord"] });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<DiscordSettings>("/api/settings/discord", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      setWebhook("");
      setError(null);
      invalidate();
    },
    onError: (e) => setError((e as Error).message),
  });

  const test = useMutation({
    mutationFn: () => api("/api/settings/discord/test", { method: "POST" }),
    onError: (e) => setError((e as Error).message),
    onMutate: () => setError(null),
  });

  const configured = data?.configured ?? false;
  const events = data?.events;

  return (
    <main>
      <Topbar title="Discord" />
      <div className="max-w-3xl space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" /> Discord webhook
            </CardTitle>
            <CardDescription>
              Paste a channel webhook URL (Server Settings → Integrations → Webhooks) and MetaMagic
              will post updates there.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="discord">Webhook URL</Label>
                {configured && <Badge variant="success">configured</Badge>}
              </div>
              <Input
                id="discord"
                type="password"
                placeholder={configured ? "•••••••• (saved)" : "https://discord.com/api/webhooks/…"}
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
              />
            </div>

            {error && (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4 shrink-0" /> {error}
              </p>
            )}
            {test.isSuccess && !error && (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" /> Test message sent.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                loading={save.isPending && save.variables?.webhookUrl !== undefined}
                disabled={!webhook.trim()}
                onClick={() => save.mutate({ webhookUrl: webhook.trim() })}
              >
                Save webhook
              </Button>
              <Button
                variant="outline"
                loading={test.isPending}
                disabled={!configured}
                onClick={() => test.mutate()}
              >
                Send test
              </Button>
              {configured && (
                <Button variant="ghost" onClick={() => save.mutate({ webhookUrl: "" })}>
                  Remove
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What to notify</CardTitle>
            <CardDescription>
              Choose which changes ping Discord. Everything you turn on also appears on the Activity
              page regardless.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {EVENT_ROWS.map((row) => {
              const on = events?.[row.key] ?? false;
              return (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-4 rounded-md border border-border/60 bg-secondary/20 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{row.label}</p>
                    <p className="text-xs text-muted-foreground">{row.hint}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={on ? "default" : "outline"}
                    disabled={!configured || save.isPending}
                    onClick={() => save.mutate({ events: { [row.key]: !on } })}
                  >
                    {on ? "On" : "Off"}
                  </Button>
                </div>
              );
            })}
            {!configured && (
              <p className="pt-1 text-xs text-muted-foreground">
                Save a webhook above to enable notifications.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
