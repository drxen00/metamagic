import type { FastifyBaseLogger } from "fastify";
import type { PlexClient } from "./plex.js";
import { getAppSetting, setAppSetting } from "./db.js";
import { mediuxAutoSyncEnabled, runMediuxAutoSync } from "./mediux-sync.js";
import { presetAutomationsAnyEnabled, runPresetAutomations } from "./automations.js";

const SIG_KEY = "watcher_signature";

/**
 * A cheap fingerprint of the libraries: per movie/show section, its item count
 * and newest addedAt. Adding, removing, or refreshing content flips it — one
 * light query per section, so it's fine to run every minute.
 */
export async function librarySignature(client: PlexClient): Promise<string> {
  const sections = await client.sections();
  const parts: string[] = [];
  for (const s of sections) {
    if (s.type !== "movie" && s.type !== "show") continue;
    const page = await client.sectionItems(s.id, { offset: 0, limit: 1, sort: "addedAt:desc" });
    parts.push(`${s.id}:${page.totalSize}:${page.items[0]?.addedAt ?? 0}`);
  }
  return parts.join("|");
}

/**
 * The "make it feel instant" loop: when the library fingerprint changes, react
 * right away — re-sync tracked MediUX items and run the enabled preset
 * automations — rather than waiting for the daily/scheduled tick.
 */
export async function runWatcherTick(client: PlexClient, log: FastifyBaseLogger): Promise<void> {
  // Nothing to react with — skip the Plex calls entirely.
  if (!mediuxAutoSyncEnabled() && !presetAutomationsAnyEnabled()) return;

  let sig: string;
  try {
    sig = await librarySignature(client);
  } catch {
    return; // Plex unreachable — try next tick.
  }

  const stored = getAppSetting(SIG_KEY);
  // First run (or right after enabling): record the baseline, don't reprocess
  // the whole existing library.
  if (!stored) {
    setAppSetting(SIG_KEY, sig);
    return;
  }
  if (sig === stored) return;

  setAppSetting(SIG_KEY, sig);
  log.info("library change detected — running automations");
  try {
    await runMediuxAutoSync(client, log);
  } catch (err) {
    log.error({ err }, "watcher: mediux sync threw");
  }
  try {
    await runPresetAutomations(client, log, { ignoreGate: true });
  } catch (err) {
    log.error({ err }, "watcher: preset automations threw");
  }
}
