"use client";

import * as React from "react";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";

const THEMES = [
  { id: "blue", label: "Blue", swatch: "bg-[#3b82f6]" },
  { id: "purple", label: "Purple", swatch: "bg-[#8b5cf6]" },
  { id: "green", label: "Green", swatch: "bg-[#22c55e]" },
  { id: "orange", label: "Orange", swatch: "bg-[#f97316]" },
  { id: "midnight", label: "Midnight", swatch: "bg-[#7c3aed]" },
] as const;

const WILD_THEMES = [
  { id: "cyberpunk", label: "Cyberpunk", swatch: "bg-[#ff2a6d]" },
  { id: "synthwave", label: "Synthwave", swatch: "bg-[#ff2d95]" },
  { id: "vaporwave", label: "Vaporwave", swatch: "bg-[#ff6ec7]" },
  { id: "cyber", label: "Y2K Cyber", swatch: "bg-[#00d4ff]" },
  { id: "terminal", label: "Terminal", swatch: "bg-[#00ff41]" },
  { id: "amber", label: "Amber CRT", swatch: "bg-[#ffb000]" },
  { id: "winamp", label: "Winamp", swatch: "bg-[#00ff00]" },
  { id: "vhs", label: "VHS", swatch: "bg-[#b8c4d0]" },
  { id: "noir", label: "Film Noir", swatch: "bg-[#c9a855]" },
] as const;

const FONTS = [
  { id: "inter", label: "Inter", hint: "default" },
  { id: "grotesk", label: "Space Grotesk", hint: "modern" },
  { id: "mono", label: "JetBrains Mono", hint: "code" },
  { id: "orbitron", label: "Orbitron", hint: "sci-fi" },
  { id: "vt323", label: "VT323", hint: "retro CRT" },
] as const;

const THEME_KEY = "metamagic-theme";
const FONT_KEY = "metamagic-font";

export function Topbar({ title, actions }: { title: string; actions?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [theme, setTheme] = React.useState("blue");
  const [font, setFont] = React.useState("inter");

  React.useEffect(() => {
    setTheme(localStorage.getItem(THEME_KEY) ?? "blue");
    setFont(localStorage.getItem(FONT_KEY) ?? "inter");
  }, []);

  const applyTheme = (id: string) => {
    document.documentElement.dataset.theme = id;
    localStorage.setItem(THEME_KEY, id);
    setTheme(id);
  };

  const applyFont = (id: string) => {
    if (id === "inter") {
      delete document.documentElement.dataset.font;
    } else {
      document.documentElement.dataset.font = id;
    }
    localStorage.setItem(FONT_KEY, id);
    setFont(id);
  };

  const swatchButton = (t: { id: string; label: string; swatch: string }) => (
    <button
      key={t.id}
      onClick={() => applyTheme(t.id)}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-secondary",
        theme === t.id && "bg-secondary",
      )}
    >
      <span className={cn("h-3 w-3 rounded-full", t.swatch)} />
      {t.label}
    </button>
  );

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-background/70 px-6 backdrop-blur-xl [mask-image:linear-gradient(to_bottom,black_85%,transparent)]">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">
        {actions}
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Appearance"
            title="Appearance"
          >
            <Palette className="h-4.5 w-4.5" />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
              <div className="absolute right-0 top-11 z-50 flex max-h-[75vh] w-56 flex-col overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-lg">
                <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Classic
                </p>
                {THEMES.map(swatchButton)}
                <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Wild
                </p>
                {WILD_THEMES.map(swatchButton)}
                <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Font
                </p>
                {FONTS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => applyFont(f.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm hover:bg-secondary",
                      font === f.id && "bg-secondary",
                    )}
                  >
                    {f.label}
                    <span className="text-xs text-muted-foreground">{f.hint}</span>
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
