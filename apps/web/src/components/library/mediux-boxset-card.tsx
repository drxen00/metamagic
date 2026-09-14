"use client";

import { Boxes } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MediuxImportPanel } from "./mediux-import-panel";

/**
 * Apply a whole MediUX boxset — a bundle of "like" sets (e.g. all DreamWorks) —
 * across every matching collection at once, and keep them in auto-sync.
 */
export function MediuxBoxsetCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-primary" /> MediUX boxset
        </CardTitle>
        <CardDescription>
          Re-poster a whole boxset in one go. Open a boxset on MediUX (e.g.{" "}
          <span className="text-foreground/80">mediux.pro/boxsets/1027</span>), use its{" "}
          <strong>Copy YAML</strong>, and paste it below — MetaMagic applies every set to the
          collections it matches and tracks each one for auto-sync. (MediUX has no public API, so the
          YAML is pasted rather than pulled from the link.)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MediuxImportPanel rows={8} boxset />
      </CardContent>
    </Card>
  );
}
