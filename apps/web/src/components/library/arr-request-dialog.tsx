"use client";

import * as React from "react";
import { AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * Mandatory-acknowledgement gate before sending anything to Radarr/Sonarr.
 * The confirm button stays disabled until the checkbox is ticked, because —
 * depending on the user's *arr monitoring/list settings — a single request can
 * fan out into a large search.
 */
export function ArrRequestDialog({
  open,
  title,
  target,
  loading,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** What's being requested, e.g. a movie title. */
  title: string;
  /** "Radarr" | "Sonarr". */
  target: string;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [ack, setAck] = React.useState(false);
  React.useEffect(() => {
    if (!open) setAck(false);
  }, [open]);

  if (!open) return null;

  return (
    <Dialog open onClose={onClose} title="Request a download?">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          MetaMagic will ask <strong className="text-foreground">{target}</strong> to add and search
          for <strong className="text-foreground">{title}</strong>.
        </p>
        <div className="flex gap-2.5 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-foreground/90">
            Depending on your {target} settings (monitoring, lists, quality profiles), this can kick
            off a search — and sometimes a much larger one than you expect. Only proceed if you
            understand what your {target} setup will do.
          </p>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span>I understand this may trigger searches and downloads in {target}.</span>
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ack} loading={loading} onClick={onConfirm}>
            <Download className="h-4 w-4" /> Request from {target}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
