import type { ActivityEvent } from "@metamagic/shared";
import { listActivityEvents, recordActivityEvent } from "./db.js";

/**
 * Record something MetaMagic did so it shows on the Activity timeline. Central
 * seam: this is also where Discord notifications will fan out per event kind.
 * Never throws — activity logging must not break the action it describes.
 */
export function recordActivity(e: Omit<ActivityEvent, "id" | "ts">): void {
  try {
    recordActivityEvent(e);
  } catch {
    // Logging is best-effort.
  }
}

export function listActivity(limit = 100): ActivityEvent[] {
  return listActivityEvents(limit);
}
