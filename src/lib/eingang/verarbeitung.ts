import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyNewLead } from "@/lib/notifications";
import {
  META_STANDARD_TOKEN_ENV,
  benachrichtigungText,
  dedupeSchluessel,
  leadName,
  leadZeile,
  metaConfig,
  pruefeLead,
  type EingangLead,
  type EingangStatus,
  type QuellenArt,
} from "./logik";

/**
 * Lead-Eingang: Datenbank-Teil (Service-Rolle). Wird von den Webhooks
 * /api/webhooks/leads/[token] und /api/webhooks/meta-leads sowie von „Testlead senden“ benutzt.
 * Jeder Eingang landet in lead_eingang – Fehler werden nie verschluckt.
 */

export interface LeadQuelleZeile {
  id: string;
  company_id: string;
  art: QuellenArt;
  name: string;
  token: string;
  aktiv: boolean;
  config: Record<string, unknown>;
  letzte_eingang_am: string | null;
  created_at: string;
}

export interface LeadEingangZeile {
  id: string;
  quelle_id: string | null;
  company_id: string | null;
  external_id: string | null;
  payload: unknown;
  status: EingangStatus;
  fehler: string | null;
  lead_id: string | null;
  created_at: string;
}

export interface SpeicherErgebnis {
  status: EingangStatus;
  eingangId: string | null;
  leadId: string | null;
  fehler: string | null;
  /** true = Lead konnte nicht gespeichert werden, Absender darf es erneut versuchen */
  nochmal: boolean;
}

const EINDEUTIG = "23505";

/** Eintrag ins Rohprotokoll (wirft nie – das Protokoll darf den Webhook nicht kippen) */
export async function protokolliere(
  db: SupabaseClient,
  zeile: {
    quelle_id: string | null;
    company_id: string | null;
    status: EingangStatus;
    payload: unknown;
    fehler?: string | null;
    external_id?: string | null;
    lead_id?: string | null;
  },
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("lead_eingang")
      .insert({ external_id: null, lead_id: null, fehler: null, ...zeile })
      .select("id")
      .single();
    if (error) {
      await db.from("webhook_errors").insert({ endpoint: "lead-eingang", payload: zeile.payload ?? null, error: `Protokoll: ${error.message}` });
      return null;
    }
    return (data as { id: string }).id;
  } catch (err) {
    console.error("[lead-eingang] Protokoll fehlgeschlagen:", err);
    return null;
  }
}

async function bestehenderLead(db: SupabaseClient, companyId: string, schluessel: string): Promise<string | null> {
  const { data } = await db.from("leads").select("id").eq("company_id", companyId).eq("external_id", schluessel).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Lead prüfen, gegen Duplikate sperren, in public.leads speichern, Glocke für den Betrieb.
 * E-Mail an den Betrieb macht emailAnBetrieb() (Aufrufer startet sie per after()).
 */
export async function speichereLead(
  db: SupabaseClient,
  quelle: Pick<LeadQuelleZeile, "id" | "company_id" | "art" | "name">,
  lead: EingangLead,
  payload: unknown,
  jetzt = new Date(),
): Promise<SpeicherErgebnis> {
  const basis = { quelle_id: quelle.id, company_id: quelle.company_id, payload };

  const ungueltig = pruefeLead(lead);
  if (ungueltig) {
    const eingangId = await protokolliere(db, { ...basis, status: "fehler", fehler: ungueltig });
    return { status: "fehler", eingangId, leadId: null, fehler: ungueltig, nochmal: false };
  }

  const schluessel = dedupeSchluessel(quelle.art, lead, jetzt);

  // 1. Sperre: unique(quelle_id, external_id) – doppelte Zustellung desselben Leads
  const sperre = await db
    .from("lead_eingang")
    .insert({ ...basis, external_id: schluessel, status: "ok" })
    .select("id")
    .single();
  if (sperre.error) {
    if (sperre.error.code === EINDEUTIG) {
      const leadId = await bestehenderLead(db, quelle.company_id, schluessel);
      const eingangId = await protokolliere(db, { ...basis, status: "duplikat", lead_id: leadId, fehler: `Schon erhalten (${schluessel})` });
      return { status: "duplikat", eingangId, leadId, fehler: null, nochmal: false };
    }
    throw new Error(`Protokoll fehlgeschlagen: ${sperre.error.message}`);
  }
  const eingangId = (sperre.data as { id: string }).id;

  // 2. Lead speichern – unique(company_id, external_id) fängt Duplikate über Quellen hinweg
  const ins = await db.from("leads").insert(leadZeile(lead, quelle, schluessel, payload)).select("id").single();
  if (ins.error) {
    if (ins.error.code === EINDEUTIG) {
      const leadId = await bestehenderLead(db, quelle.company_id, schluessel);
      await db.from("lead_eingang").update({ status: "duplikat", lead_id: leadId, fehler: "Lead gibt es schon (gleiche Kennung)" }).eq("id", eingangId);
      return { status: "duplikat", eingangId, leadId, fehler: null, nochmal: false };
    }
    const fehler = `Lead nicht gespeichert: ${ins.error.message}`;
    // Sperre lösen (external_id = null), damit ein erneuter Versuch des Absenders durchgeht
    await db.from("lead_eingang").update({ status: "fehler", fehler, external_id: null }).eq("id", eingangId);
    return { status: "fehler", eingangId, leadId: null, fehler, nochmal: true };
  }
  const leadId = (ins.data as { id: string }).id;

  const hinweise: string[] = [];
  const [eRes, qRes] = await Promise.all([
    db.from("lead_eingang").update({ lead_id: leadId }).eq("id", eingangId),
    db.from("lead_quellen").update({ letzte_eingang_am: jetzt.toISOString() }).eq("id", quelle.id),
  ]);
  if (eRes.error) hinweise.push(`Protokoll: ${eRes.error.message}`);
  if (qRes.error) hinweise.push(`Quelle: ${qRes.error.message}`);

  // 3. Glocke im Kundenportal (für alle Zugänge der Firma)
  const b = benachrichtigungText(lead);
  const nRes = await db.from("benachrichtigungen").insert({
    company_id: quelle.company_id,
    user_id: null,
    typ: lead.test ? "testlead" : "neuer_lead",
    titel: b.titel,
    text: b.text,
    link: `/leads/${leadId}`,
  });
  if (nRes.error) hinweise.push(`Benachrichtigung: ${nRes.error.message}`);
  if (hinweise.length) await db.from("lead_eingang").update({ fehler: hinweise.join(" · ").slice(0, 1000) }).eq("id", eingangId);

  return { status: "ok", eingangId, leadId, fehler: null, nochmal: false };
}

const esc = (s: string | null) =>
  s ? s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c) : null;

/**
 * E-Mail an die Inhaber des Betriebs – nur wenn companies.benachrichtigung_email an ist (Standard AUS),
 * nie für Testleads, nur mit RESEND_API_KEY. Ergebnis/Fehler wird im Protokoll vermerkt.
 */
export async function emailAnBetrieb(db: SupabaseClient, companyId: string, lead: EingangLead, eingangId: string | null): Promise<void> {
  if (lead.test || !process.env.RESEND_API_KEY) return;
  try {
    const { data: firma, error } = await db.from("companies").select("name, benachrichtigung_email").eq("id", companyId).maybeSingle();
    if (error || !firma || (firma as { benachrichtigung_email?: boolean }).benachrichtigung_email !== true) return;
    const { data: inhaber } = await db
      .from("profiles")
      .select("email")
      .eq("company_id", companyId)
      .eq("role", "client_owner")
      .eq("active", true);
    const an = ((inhaber ?? []) as { email: string | null }[]).map((p) => p.email).filter((e): e is string => !!e);
    if (!an.length) return;
    await notifyNewLead({
      to: an,
      leadName: esc(leadName(lead)) ?? "Neuer Lead",
      anliegen: esc(lead.anliegen ?? lead.antworten[0]?.antwort ?? null),
      ort: esc([lead.plz, lead.ort].filter(Boolean).join(" ") || null),
      companyName: esc((firma as { name: string }).name) ?? "",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (eingangId) await db.from("lead_eingang").update({ fehler: `E-Mail an Betrieb fehlgeschlagen: ${msg}`.slice(0, 1000) }).eq("id", eingangId);
  }
}

// ---------------------------------------------------------------------------
// Meta Graph API
// ---------------------------------------------------------------------------

export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const META_FELDER_VOLL = "field_data,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic";
const META_FELDER_MIN = "field_data,created_time,form_id";

/** Name der Env-Variable mit dem Seiten-Token dieser Quelle (Wert bleibt auf dem Server) */
export function metaTokenEnvName(config: unknown): string {
  return metaConfig(config).tokenEnv ?? META_STANDARD_TOKEN_ENV;
}

export async function holeMetaLead(
  leadgenId: string,
  token: string,
): Promise<{ daten: Record<string, unknown> } | { fehler: string }> {
  if (!/^\d{3,30}$/.test(leadgenId)) return { fehler: `Ungültige leadgen_id ${leadgenId}` };
  const abruf = async (felder: string) => {
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${leadgenId}?fields=${felder}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, status: res.status, json };
  };
  try {
    let r = await abruf(META_FELDER_VOLL);
    // Ohne Werbe-Berechtigung (ads_read) lehnt Meta Anzeigen-/Kampagnenfelder ab → nur Formulardaten
    if (!r.ok) r = await abruf(META_FELDER_MIN);
    if (!r.ok || !r.json) {
      const fehler = (r.json?.error as { message?: string } | undefined)?.message ?? `HTTP ${r.status}`;
      return { fehler: `Meta Graph API: ${fehler}` };
    }
    return { daten: r.json };
  } catch (err) {
    return { fehler: `Meta Graph API nicht erreichbar: ${err instanceof Error ? err.message : String(err)}` };
  }
}
