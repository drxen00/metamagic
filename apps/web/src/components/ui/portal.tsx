"use client";

import * as React from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into document.body. Overlays (dialogs, sheets) must escape
 * ancestors with CSS transforms/filters, which hijack fixed positioning.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
