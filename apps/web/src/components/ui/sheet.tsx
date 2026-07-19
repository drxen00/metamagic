"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

/** Right-side slide-over panel (item detail drawer). */
export function Sheet({ open, onClose, children, className }: SheetProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[1300] transition-[visibility]",
        open ? "visible" : "invisible delay-300",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          "absolute inset-y-0 right-0 w-full max-w-lg overflow-y-auto bg-card shadow-[-8px_0_40px_rgba(0,0,0,0.45)]",
          "transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
          className,
        )}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-md bg-background/60 p-1.5 text-muted-foreground backdrop-blur hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        {open && children}
      </div>
    </div>
  );
}
