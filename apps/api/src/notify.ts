import type { Rule, RuleRun } from "@metamagic/shared";
import { getAppSetting } from "./db.js";

const DISCORD_KEY = "discord_webhook_url";

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

/** Fired after a rule run that did something worth reporting. */
export async function notifyRuleRun(run: RuleRun, rule: Rule): Promise<void> {
  const webhookUrl = getAppSetting(DISCORD_KEY);
  if (!webhookUrl) return;
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
