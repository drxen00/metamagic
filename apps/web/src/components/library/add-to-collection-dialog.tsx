"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, SquareStack } from "lucide-react";
import type { PlexCollection } from "@metamagic/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface AddToCollectionDialogProps {
  open: boolean;
  onClose: () => void;
  sectionId: string;
  itemRatingKeys: string[];
  onDone?: () => void;
}

export function AddToCollectionDialog({
  open,
  onClose,
  sectionId,
  itemRatingKeys,
  onDone,
}: AddToCollectionDialogProps) {
  const qc = useQueryClient();
  const [newName, setNewName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const { data: collections } = useQuery({
    queryKey: ["collections", sectionId],
    queryFn: () => api<PlexCollection[]>(`/api/collections?sectionId=${sectionId}`),
    enabled: open,
  });

  const finish = () => {
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["items"] });
    qc.invalidateQueries({ queryKey: ["item"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    setNewName("");
    setError(null);
    onDone?.();
    onClose();
  };

  const addExisting = useMutation({
    mutationFn: (collection: PlexCollection) =>
      api(`/api/collections/${collection.ratingKey}/items`, {
        method: "POST",
        body: JSON.stringify({ itemRatingKeys }),
      }),
    onSuccess: finish,
    onError: (e) => setError((e as Error).message),
  });

  const createNew = useMutation({
    mutationFn: () =>
      api("/api/collections", {
        method: "POST",
        body: JSON.stringify({ sectionId, title: newName.trim(), itemRatingKeys }),
      }),
    onSuccess: finish,
    onError: (e) => setError((e as Error).message),
  });

  const busy = addExisting.isPending || createNew.isPending;
  const count = itemRatingKeys.length;

  return (
    <Dialog open={open} onClose={onClose} title={`Add ${count} item${count === 1 ? "" : "s"} to collection`}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="New collection name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newName.trim() && createNew.mutate()}
            disabled={busy}
          />
          <Button
            onClick={() => createNew.mutate()}
            disabled={!newName.trim()}
            loading={createNew.isPending}
          >
            <Plus className="h-4 w-4" /> Create
          </Button>
        </div>

        {collections && collections.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Or pick an existing collection
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {collections.map((c) => (
                <button
                  key={c.ratingKey}
                  disabled={busy}
                  onClick={() => addExisting.mutate(c)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left text-sm",
                    "hover:border-border hover:bg-secondary/60 disabled:opacity-50",
                  )}
                >
                  <SquareStack className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{c.title}</span>
                  <span className="text-xs text-muted-foreground">{c.childCount}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </Dialog>
  );
}
