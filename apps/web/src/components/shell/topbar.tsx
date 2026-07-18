"use client";

import * as React from "react";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";

const THEMES = [
  { id: "blue", label: "Blue", swatch: "bg-[#3b82f6]" },
  { id: "purple", label: "Purple", swatch: "bg-[#8b5cf6]" },
  { id: "green", label: "Green", swatch: "bg-[#22c55e]" },
  { id: "orange", label: "Orange", swatch: "bg-[#f97316]" },
  { id: "synthwave", label: "Synthwave", swatch: "bg-[#ec4899]" },
  { id: "midnight", label: "Midnight", swatch: "bg-[#7c3aed]" },
] as const;

const STORAGE_KEY = "metamagic-theme";

export function Topbar({ title, actions }: { title: string; actions?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [theme, setTheme] = React.useState("blue");

  React.useEffect(() => {
    setTheme(localStorage.getItem(STORAGE_KEY) ?? "blue");
  }, []);

  const apply = (id: string) => {
    document.documentElement.dataset.theme = id;
    localStorage.setItem(STORAGE_KEY, id);
    setTheme(id);
    setOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-xl">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">
        {actions}
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Change theme"
          >
            <Palette className="h-4.5 w-4.5" />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
              <div className="absolute right-0 top-11 z-50 w-44 rounded-lg border border-border bg-popover p-1.5 shadow-lg">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => apply(t.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-secondary",
                      theme === t.id && "bg-secondary",
                    )}
                  >
                    <span className={cn("h-3 w-3 rounded-full", t.swatch)} />
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
