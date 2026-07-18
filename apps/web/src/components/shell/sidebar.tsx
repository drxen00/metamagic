"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  Layers,
  LayoutDashboard,
  Library,
  LogOut,
  Settings,
  SquareStack,
  Wand2,
} from "lucide-react";
import type { ConnectionStatus } from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/library", label: "Library", icon: Library },
  { href: "/collections", label: "Collections", icon: SquareStack },
  { href: "/rules", label: "Rules", icon: Wand2 },
  { href: "/overlays", label: "Overlays", icon: Layers },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const onLogin = pathname === "/login";
  const { data: connection } = useQuery({
    queryKey: ["connection"],
    queryFn: () => api<ConnectionStatus>("/api/settings/connection"),
    refetchInterval: 60_000,
    enabled: !onLogin,
  });

  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      window.location.href = "/login";
    },
  });

  if (onLogin) return null;

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" className="h-9 w-auto" />
        <span className="gradient-text text-lg font-bold tracking-tight">MetaMagic</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-primary/15 text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-sidebar-border p-4">
        <Link href="/settings" className="flex min-w-0 items-center gap-2.5 text-xs">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              connection?.connected ? "bg-success" : "bg-muted-foreground/40",
            )}
          />
          <span className="truncate text-sidebar-foreground/70">
            {connection?.connected
              ? (connection.server?.name ?? "Connected to Plex")
              : "Not connected"}
          </span>
        </Link>
        <button
          onClick={() => logout.mutate()}
          aria-label="Sign out"
          title="Sign out"
          className="shrink-0 rounded-md p-1.5 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
