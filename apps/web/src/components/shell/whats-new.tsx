"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Check, Plus, Sparkles, Wrench } from "lucide-react";
import { CHANGELOG, CURRENT_VERSION, type ChangelogEntry } from "@/lib/changelog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

const STORAGE_KEY = "metamagic-seen-version";

/**
 * A polished "What's new" dialog that appears once after an update. It compares
 * the last version this browser acknowledged against the current changelog and
 * shows everything in between. Purely client-side (localStorage).
 */
export function WhatsNew() {
  const pathname = usePathname();
  const [entries, setEntries] = React.useState<ChangelogEntry[] | null>(null);

  React.useEffect(() => {
    if (pathname === "/login") return;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(STORAGE_KEY);
    } catch {
      return; // storage blocked — skip silently
    }
    if (seen === CURRENT_VERSION) return;

    const idx = CHANGELOG.findIndex((c) => c.version === seen);
    // Unknown/first-run → just the latest; otherwise everything newer than seen.
    setEntries(idx === -1 ? [CHANGELOG[0]] : CHANGELOG.slice(0, idx));
  }, [pathname]);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
    } catch {
      /* ignore */
    }
    setEntries(null);
  };

  if (!entries || entries.length === 0) return null;

  return (
    <Dialog open onClose={dismiss} title="" className="max-w-lg">
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-bold tracking-tight">What&apos;s new</h2>
            <p className="text-xs text-muted-foreground">
              MetaMagic {CURRENT_VERSION} · thanks for updating
            </p>
          </div>
        </div>

        <div className="max-h-[60vh] space-y-6 overflow-y-auto pr-1">
          {entries.map((entry) => (
            <div key={entry.version} className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold">{entry.title}</h3>
                <span className="shrink-0 text-xs text-muted-foreground">v{entry.version}</span>
              </div>
              {entry.added && entry.added.length > 0 && (
                <ul className="space-y-1.5">
                  {entry.added.map((line, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              )}
              {entry.fixed && entry.fixed.length > 0 && (
                <ul className="space-y-1.5">
                  {entry.fixed.map((line, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="text-muted-foreground">{line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button onClick={dismiss}>
            <Check className="h-4 w-4" /> Got it
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
