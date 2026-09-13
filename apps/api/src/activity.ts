import type { ActivityEvent } from "@metamagic/shared";
import { listActivityEvents, recordActivityEvent } from "./db.js";
import { notifyActivityEvent } from "./notify.js";

/**
 * Record something MetaMagic did so it shows on the Activity timeline, and fan
 * it out to Discord (gated per category). Never throws — activity logging and
 * notifications must not break the action they describe.
 */
export function recordActivity(e: Omit<ActivityEvent, "id" | "ts">): void {
  const event: ActivityEvent = { id: 0, ts: Date.now(), ...e };
  try {
    recordActivityEvent(event);
  } catch {
    // Logging is best-effort.
  }
  void notifyActivityEvent(event);
}

export function listActivity(limit = 100): ActivityEvent[] {
  return listActivityEvents(limit);
}
