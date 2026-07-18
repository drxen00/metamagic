"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Clapperboard, Plug, Server, SquareStack, Tv } from "lucide-react";
import type { DashboardData } from "@metamagic/shared";
import { api } from "@/lib/api";
import { Topbar } from "@/components/shell/topbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardData>("/api/dashboard"),
  });

  return (
    <main>
      <Topbar title="Dashboard" />
      <div className="space-y-6 p-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : !data?.connected ? (
          <EmptyState
            icon={Plug}
            title="Connect your Plex server"
            description="MetaMagic needs a Plex server to work its magic. Add your server URL and token to get started."
            action={
              <Button className="mt-2">
                <Link href="/settings">Go to Settings</Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={<Server className="h-5 w-5 text-primary" />}
                label="Server"
                value={data.server?.name ?? "Plex"}
                sub={data.server?.version}
              />
              {data.sections.slice(0, 2).map((s) => (
                <StatCard
                  key={s.id}
                  icon={
                    s.type === "show" ? (
                      <Tv className="h-5 w-5 text-primary" />
                    ) : (
                      <Clapperboard className="h-5 w-5 text-primary" />
                    )
                  }
                  label={s.title}
                  value={String(s.count ?? "—")}
                  sub={s.type === "show" ? "series" : "movies"}
                />
              ))}
              <StatCard
                icon={<SquareStack className="h-5 w-5 text-primary" />}
                label="Collections"
                value={String(data.collectionCount)}
                sub="across all libraries"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Libraries</CardTitle>
                <CardDescription>Sections MetaMagic can manage on {data.server?.name}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {data.sections.map((s) => (
                  <Link key={s.id} href={`/library?section=${s.id}`}>
                    <Badge variant="secondary" className="cursor-pointer px-3 py-1.5 text-sm hover:bg-secondary/70">
                      {s.title}
                      <span className="text-muted-foreground">· {s.count ?? "—"}</span>
                    </Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="glass">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="truncate text-xl font-bold">{value}</p>
          {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
