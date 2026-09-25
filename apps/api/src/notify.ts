import type { ActivityEvent, DiscordEvents, Rule, RuleRun } from "@metamagic/shared";
import { getAppSetting } from "./db.js";

const DISCORD_KEY = "discord_webhook_url";
const EVENTS_KEY = "discord_events";

const DEFAULT_EVENTS: DiscordEvents = {
  rules: true,
  mediuxSync: true,
  mediuxApply: false,
  overlays: false,
  collections: false,
  artwork: false,
  downloads: true,
};

export function getDiscordEvents(): DiscordEvents {
  const raw = getAppSetting(EVENTS_KEY);
  if (!raw) return DEFAULT_EVENTS;
  try {
    return { ...DEFAULT_EVENTS, ...(JSON.parse(raw) as Partial<DiscordEvents>) };
  } catch {
    return DEFAULT_EVENTS;
  }
}

/** Which notification category an activity event belongs to. */
function categoryFor(kind: ActivityEvent["kind"]): keyof DiscordEvents {
  switch (kind) {
    case "mediux-sync":
      return "mediuxSync";
    case "mediux-apply":
      return "mediuxApply";
    case "overlay-apply":
    case "overlay-restore":
      return "overlays";
    case "collection-created":
    case "collection-updated":
    case "collection-deleted":
      return "collections";
    case "download-request":
      return "downloads";
    default:
      return "artwork";
  }
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  footer?: { text: string };
  timestamp?: string;
}

async function post(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "MetaMagic", embeds: [embed] }),
    signal: AbortSignal.timeout(10_000),
  });
}

export async function sendTestNotification(webhookUrl: string): Promise<void> {
  await post(webhookUrl, {
    title: "MetaMagic is connected",
    description: "Automation notifications will show up here.",
    color: 0x5b36e0,
    timestamp: new Date().toISOString(),
  });
}

/** Fired after any recorded activity event — pings Discord when its category is on. */
export async function notifyActivityEvent(event: ActivityEvent): Promise<void> {
  const webhookUrl = getAppSetting(DISCORD_KEY);
  if (!webhookUrl) return;
  if (!getDiscordEvents()[categoryFor(event.kind)]) return;

  try {
    await post(webhookUrl, {
      title: `${event.status === "error" ? "❌" : "✅"} ${event.title}`,
      description: [event.trigger && `_${event.trigger}_`, event.detail, event.url]
        .filter(Boolean)
        .join("\n"),
      color: event.status === "error" ? 0xef4444 : 0x5b36e0,
      timestamp: new Date(event.ts).toISOString(),
    });
  } catch {
    // Never let a notification failure break the action it describes.
  }
}

/** One item that changed during a MediUX auto-sync sweep. */
export interface MediuxSweepChange {
  title: string;
  detail: string;
  status: "ok" | "error";
}

/**
 * One batched Discord message for a whole auto-sync sweep, instead of a ping per
 * tracked item. Keeps the "mediuxSync" category gate.
 */
export async function notifyMediuxSweep(
  changes: MediuxSweepChange[],
  trigger: string,
): Promise<void> {
  if (changes.length === 0) return;
  const webhookUrl = getAppSetting(DISCORD_KEY);
  if (!webhookUrl) return;
  if (!getDiscordEvents().mediuxSync) return;

  const failed = changes.filter((c) => c.status === "error").length;
  const ok = changes.length - failed;
  const lines = changes
    .slice(0, 25)
    .map((c) => `${c.status === "error" ? "❌" : "•"} **${c.title}** — ${c.detail}`);
  if (changes.length > 25) lines.push(`…and ${changes.length - 25} more`);

  const title = failed
    ? `⚠️ MediUX auto-sync · ${ok} updated, ${failed} failed`
    : `✅ MediUX auto-sync · ${ok} updated`;

  try {
    await post(webhookUrl, {
      title,
      description: [`_${trigger}_`, ...lines].join("\n"),
      color: failed ? 0xf59e0b : 0x5b36e0,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Never let a notification failure break the sweep it describes.
  }
}

/** Fired after a rule run that did something worth reporting. */
export async function notifyRuleRun(run: RuleRun, rule: Rule): Promise<void> {
  const webhookUrl = getAppSetting(DISCORD_KEY);
  if (!webhookUrl) return;
  if (!getDiscordEvents().rules) return;
  if (run.status === "no-changes") return;

  const parts: string[] = [];
  if (run.addedCount > 0) parts.push(`**${run.addedCount}** added`);
  if (run.removedCount > 0) parts.push(`**${run.removedCount}** removed`);

  const byStatus = {
    applied: {
      title: `✅ ${rule.name}`,
      description: `${parts.join(" · ")} in “${rule.collectionTitle}”.`,
      color: 0x22c55e,
    },
    pending: {
      title: `⏳ ${rule.name} needs approval`,
      description: `${parts.join(" · ")} ready to apply to “${rule.collectionTitle}”. Open MetaMagic → Activity to review.`,
      color: 0xf59e0b,
    },
    error: {
      title: `❌ ${rule.name} failed`,
      description: run.error ?? "Unknown error",
      color: 0xef4444,
    },
  } as const;

  const spec = byStatus[run.status as keyof typeof byStatus];
  if (!spec) return;

  try {
    await post(webhookUrl, {
      ...spec,
      footer: { text: run.trigger === "schedule" ? "Scheduled run" : "Manual run" },
      timestamp: new Date(run.startedAt).toISOString(),
    });
  } catch {
    // Never let a notification failure break a rule run.
  }
}
