"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ImageIcon } from "lucide-react";
import type { ArtworkProvenance, ArtworkSource } from "@metamagic/shared";
import { api } from "@/lib/api";

function SourceLine({ kind, source }: { kind: string; source: ArtworkSource }) {
  return (
    <span className="inline-flex items-center gap-1">
      {kind} from{" "}
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"
        >
          {source.label} <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <span className="text-foreground/80">{source.label}</span>
      )}
    </span>
  );
}

/** "Poster from ThePosterDB ↗ · Background from MediUX set 7028 ↗" */
export function ProvenanceNote({ ratingKey }: { ratingKey: string }) {
  const { data } = useQuery({
    queryKey: ["provenance", ratingKey],
    queryFn: () => api<ArtworkProvenance>(`/api/items/${ratingKey}/provenance`),
  });

  if (!data?.poster && !data?.art) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      <ImageIcon className="h-3 w-3 shrink-0" />
      {data.poster && <SourceLine kind="Poster" source={data.poster} />}
      {data.poster && data.art && <span aria-hidden>·</span>}
      {data.art && <SourceLine kind="Background" source={data.art} />}
    </p>
  );
}
