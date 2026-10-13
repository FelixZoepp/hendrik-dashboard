import type { SupabaseClient } from "@supabase/supabase-js";
import { closeApi } from "@/lib/integrations/close";
import { speichereEinstellung } from "./einstellungen";

/**
 * Einmalige Einrichtung (nur per Knopf im Dashboard): Close-Einwilligungsfeld und Calendly-Webhook.
 * Läuft serverseitig, weil CLOSE_API_KEY / CALENDLY_API_KEY in Vercel geschützt (nicht lesbar) sind.
 * Beide Funktionen sind idempotent — vorhandenes Feld bzw. vorhandener Webhook wird wiederverwendet.
 */

export const CLOSE_OPTIN_FELDNAME = "WhatsApp-Bestätigung ok";

/** Webhooks laufen über die Vercel-Domain, damit sie unabhängig vom DNS der Termin-Domain funktionieren. */
function webhookBasis(): string {
  return (process.env.WEBHOOK_BASE_URL || "https://project-cej2s.vercel.app").replace(/\/+$/, "");
}

/** Lead-Feld „WhatsApp-Bestätigung ok“ (Ja/Nein) anlegen bzw. finden und als Einwilligungsfeld speichern. */
export async function legeCloseFeldAn(svc: SupabaseClient): Promise<{ feld: string; neu: boolean }> {
  const { data } = await closeApi<{ data: Array<{ id: string; name: string }> }>("/custom_field/lead/", {
    params: { _limit: "200" },
  });
  let id = data.find((f) => f.name.trim().toLowerCase() === CLOSE_OPTIN_FELDNAME.toLowerCase())?.id;
  const neu = !id;
  if (!id) {
    const f = await closeApi<{ id: string }>("/custom_field/lead/", {
      method: "POST",
      body: { name: CLOSE_OPTIN_FELDNAME, type: "choices", choices: ["Ja", "Nein"], accepts_multiple_values: false },
    });
    id = f.id;
  }
  const feld = `custom.${id}`;
  await speichereEinstellung(svc, "close_optin_feld", feld);
  return { feld, neu };
}

async function calendly<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = process.env.CALENDLY_TOKEN || process.env.CALENDLY_API_KEY;
  if (!token) throw new Error("CALENDLY_API_KEY fehlt");
  const res = await fetch(path.startsWith("http") ? path : `https://api.calendly.com${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Calendly ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** Calendly-Webhook (invitee.created/canceled) auf /api/webhooks/calendly anlegen, falls noch nicht vorhanden. */
export async function richteCalendlyWebhookEin(): Promise<{ url: string; neu: boolean; scope: string }> {
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) throw new Error("CALENDLY_WEBHOOK_SIGNING_KEY fehlt");
  const ich = await calendly<{ resource: { uri: string; current_organization: string } }>("/users/me");
  const org = ich.resource.current_organization;
  const user = ich.resource.uri;
  const url = `${webhookBasis()}/api/webhooks/calendly`;

  for (const scope of ["organization", "user"] as const) {
    const q = new URLSearchParams({ organization: org, scope, count: "100" });
    if (scope === "user") q.set("user", user);
    const vorhanden = await calendly<{ collection: Array<{ callback_url: string; state: string }> }>(
      `/webhook_subscriptions?${q}`,
    ).catch(() => ({ collection: [] }));
    if (vorhanden.collection.some((w) => w.callback_url === url && w.state === "active")) {
      return { url, neu: false, scope };
    }
  }

  const body = { url, events: ["invitee.created", "invitee.canceled"], organization: org, signing_key: signingKey };
  try {
    await calendly("/webhook_subscriptions", { method: "POST", body: { ...body, scope: "organization" } });
    return { url, neu: true, scope: "organization" };
  } catch {
    // Ohne Admin-Rechte in der Organisation nur für den eigenen Kalender möglich
    await calendly("/webhook_subscriptions", { method: "POST", body: { ...body, scope: "user", user } });
    return { url, neu: true, scope: "user" };
  }
}
