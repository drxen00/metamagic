"use client";

import { Check } from "lucide-react";
import type { MediaItem } from "@metamagic/shared";
import { cn, imageUrl } from "@/lib/utils";

interface PosterCardProps {
  item: MediaItem;
  selected?: boolean;
  selectionMode?: boolean;
  onClick: () => void;
  onToggleSelect: () => void;
}

export function PosterCard({ item, selected, selectionMode, onClick, onToggleSelect }: PosterCardProps) {
  const src = imageUrl(item.thumb, 300, 450);
  return (
    <div className="group relative transition-transform duration-200 ease-out hover:-translate-y-1">
      <button
        onClick={() => (selectionMode ? onToggleSelect() : onClick())}
        className={cn(
          "block w-full overflow-hidden rounded-lg border bg-secondary/40 transition-all",
          "aspect-[2/3]",
          selected
            ? "border-primary ring-2 ring-primary"
            : "border-border/60 hover:border-primary/50 hover:shadow-primary-glow",
        )}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={item.title}
            loading="lazy"
            className={cn(
              "h-full w-full object-cover transition-transform duration-200",
              !selectionMode && "group-hover:scale-[1.03]",
              selected && "opacity-80",
            )}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
            {item.title}
          </div>
        )}
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        aria-label={selected ? "Deselect" : "Select"}
        className={cn(
          "absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border transition-all",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-white/50 bg-black/50 text-transparent opacity-0 backdrop-blur group-hover:opacity-100",
          selectionMode && "opacity-100",
        )}
      >
        <Check className="h-3.5 w-3.5" />
      </button>

      <div className="mt-1.5 px-0.5">
        <p className="truncate text-sm font-medium leading-tight">{item.title}</p>
        <p className="text-xs text-muted-foreground">{item.year ?? " "}</p>
      </div>
    </div>
  );
}
