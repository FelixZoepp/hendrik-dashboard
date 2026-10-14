import { terminBasisUrl } from "./client";
import { formatDatum, formatUhrzeit } from "./logik";

/**
 * Hinweise des Terminbots an das Team im Slack-Kanal (Standard #03-sales).
 * Entweder SLACK_BOT_TOKEN (+ SLACK_SALES_CHANNEL, Kanal-ID oder Name) oder SLACK_WEBHOOK_URL.
 * Rein intern, best effort: wirft nie, ohne Zugang passiert einfach nichts.
 */

export interface SlackHinweis {
  emoji: string;
  titel: string;
  zeilen?: Array<string | null | undefined | false>;
  telefon?: string | null;
  closeLeadId?: string | null;
  /** Handlungsbedarf → Personen aus SLACK_ERWAEHNEN (Slack-User-IDs, kommagetrennt) markieren */
  erwaehnen?: boolean;
}

/** „<@U123> <@U456> “ aus SLACK_ERWAEHNEN */
export function erwaehnungen(roh = process.env.SLACK_ERWAEHNEN): string {
  const ids = (roh ?? "")
    .split(/[\s,;]+/)
    .map((x) => x.trim().replace(/^<?@?|>$/g, ""))
    .filter((x) => /^[UW][A-Z0-9]{5,}$/.test(x));
  return ids.map((id) => `<@${id}> `).join("");
}

interface TerminKurz {
  art: string;
  start_at: string;
  name?: string | null;
  vorname?: string | null;
  firma?: string | null;
  telefon?: string | null;
  close_lead_id?: string | null;
  gastgeber_name?: string | null;
}

export const terminArt = (t: TerminKurz) => (t.art === "strategie" ? "Strategiegespräch" : "Erstgespräch");
export const terminWann = (t: TerminKurz) =>
  `${formatDatum(new Date(t.start_at))}, ${formatUhrzeit(new Date(t.start_at))} Uhr`;

/** „Max Muster (Muster GmbH)“ bzw. Nummer, wenn kein Name bekannt ist. */
export function leadName(t: Pick<TerminKurz, "name" | "firma" | "telefon"> | null | undefined, telefon?: string | null): string {
  const name = t?.name?.trim();
  const firma = t?.firma?.trim();
  if (name && firma && firma !== name) return `${name} (${firma})`;
  return name || firma || t?.telefon || telefon || "Unbekannt";
}

/** Standardzeilen zu einem Termin: Art + Zeit, ggf. Gastgeber. */
export function terminZeilen(t: TerminKurz): string[] {
  return [
    `📅 ${terminArt(t)} · ${terminWann(t)}`,
    ...(t.gastgeber_name ? [`👤 ${t.gastgeber_name}`] : []),
  ];
}

export function baueSlackNachricht(h: SlackHinweis): { text: string; blocks: unknown[] } {
  const zeilen = [`${h.erwaehnen ? erwaehnungen() : ""}${h.emoji} *${h.titel}*`, ...(h.zeilen ?? []).filter((z): z is string => !!z)];
  if (h.telefon) zeilen.push(`📱 ${h.telefon}`);
  const knoepfe: unknown[] = [];
  if (h.telefon) {
    knoepfe.push({
      type: "button",
      text: { type: "plain_text", text: "Chat öffnen" },
      url: `${terminBasisUrl()}/sales/whatsapp/chats?nr=${encodeURIComponent(h.telefon)}`,
    });
  }
  if (h.closeLeadId) {
    knoepfe.push({
      type: "button",
      text: { type: "plain_text", text: "In Close öffnen" },
      url: `https://app.close.com/lead/${h.closeLeadId}/`,
    });
  }
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: zeilen.join("\n") } }];
  if (knoepfe.length) blocks.push({ type: "actions", elements: knoepfe });
  return { text: `${h.erwaehnen ? erwaehnungen() : ""}${h.emoji} ${h.titel}`, blocks };
}

export async function meldeSlack(h: SlackHinweis): Promise<void> {
  try {
    const nachricht = baueSlackNachricht(h);
    const token = process.env.SLACK_BOT_TOKEN?.trim();
    const webhook = process.env.SLACK_WEBHOOK_URL?.trim();
    if (token) {
      const kanal = process.env.SLACK_SALES_CHANNEL?.trim() || "03-sales";
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel: kanal, ...nachricht, unfurl_links: false }),
        signal: AbortSignal.timeout(5_000),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!j?.ok) console.error("[whatsapp] Slack-Meldung fehlgeschlagen:", j?.error ?? res.status);
    } else if (webhook) {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nachricht),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) console.error("[whatsapp] Slack-Webhook fehlgeschlagen:", res.status);
    }
  } catch (err) {
    console.error("[whatsapp] Slack-Meldung fehlgeschlagen:", err);
  }
}
