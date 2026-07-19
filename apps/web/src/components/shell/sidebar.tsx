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
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SquareStack,
  Wand2,
} from "lucide-react";
import * as React from "react";
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
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (next) {
      document.documentElement.dataset.sidebar = "collapsed";
      localStorage.setItem("metamagic-sidebar", "collapsed");
    } else {
      delete document.documentElement.dataset.sidebar;
      localStorage.setItem("metamagic-sidebar", "open");
    }
  };

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
    <aside
      className="fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden bg-sidebar text-sidebar-foreground shadow-[1px_0_24px_rgba(0,0,0,0.35)] transition-[width] duration-300 ease-out"
      style={{ width: "var(--sidebar-w)" }}
    >
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2.5",
          collapsed ? "justify-center px-0" : "px-5",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" className="h-9 w-auto shrink-0" />
        {!collapsed && (
          <span className="gradient-text truncate text-lg font-bold tracking-tight">
            MetaMagic
          </span>
        )}
      </div>

      <nav className={cn("flex-1 space-y-1 overflow-y-auto overflow-x-hidden", collapsed ? "px-2.5 py-3" : "p-3")}>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md text-sm font-medium transition-all duration-200",
                collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2",
                active
                  ? "bg-sidebar-primary/15 text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      <div
        className={cn(
          "flex shrink-0 items-center gap-2 p-3",
          collapsed ? "flex-col" : "justify-between px-4",
        )}
      >
        <Link
          href="/settings"
          title={
            connection?.connected
              ? (connection.server?.name ?? "Connected to Plex")
              : "Not connected"
          }
          className="flex min-w-0 items-center gap-2.5 text-xs"
        >
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full transition-colors",
              connection?.connected ? "bg-success" : "bg-muted-foreground/40",
            )}
          />
          {!collapsed && (
            <span className="truncate text-sidebar-foreground/70">
              {connection?.connected
                ? (connection.server?.name ?? "Connected to Plex")
                : "Not connected"}
            </span>
          )}
        </Link>
        <div className={cn("flex items-center", collapsed ? "flex-col gap-1" : "gap-1")}>
          <button
            onClick={() => logout.mutate()}
            aria-label="Sign out"
            title="Sign out"
            className="shrink-0 rounded-md p-1.5 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <button
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="shrink-0 rounded-md p-1.5 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
