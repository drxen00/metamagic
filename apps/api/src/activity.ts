import type { ActivityEvent } from "@metamagic/shared";
import { listActivityEvents, recordActivityEvent } from "./db.js";
import { notifyActivityEvent } from "./notify.js";

/**
 * Record something MetaMagic did so it shows on the Activity timeline, and fan
 * it out to Discord (gated per category). Never throws — activity logging and
 * notifications must not break the action they describe.
 *
 * Pass `{ notify: false }` to log to the timeline only — used when the caller
 * sends its own batched Discord message for a whole sweep instead of one ping
 * per item.
 */
export function recordActivity(
  e: Omit<ActivityEvent, "id" | "ts">,
  opts: { notify?: boolean } = {},
): void {
  const event: ActivityEvent = { id: 0, ts: Date.now(), ...e };
  try {
    recordActivityEvent(event);
  } catch {
    // Logging is best-effort.
  }
  if (opts.notify !== false) void notifyActivityEvent(event);
}

export function listActivity(limit = 100): ActivityEvent[] {
  return listActivityEvents(limit);
}
