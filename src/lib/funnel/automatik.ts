import { createHmac } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closeApi } from "@/lib/integrations/close";
import { pipelineStand, ABGESCHLOSSEN, type PipelineOpp } from "@/lib/close-pipeline";
import { aufgabeAnLead, findeCloseLead, notizSicher } from "@/lib/whatsapp/close-log";
import { OhneWiederholung, sendeFunnelVorlage } from "@/lib/whatsapp/gate";
import { berlinDatum, metaParameter, normalisiereTelefon, anredeName, zufallsToken } from "@/lib/whatsapp/logik";
import { meldeSlack } from "@/lib/whatsapp/slack";
import { funnelVorlage } from "@/lib/whatsapp/vorlagen";
import { ladeFunnelEinstellungen, speichereFunnelWert, type FunnelEinstellungen } from "./einstellungen";
import {
  aufgabenText,
  ergebnisFuer,
  funnelKey,
  hatEinwilligung,
  imSendefenster,
  istFestnetz,
  leseFunnelLead,
  naechstesSendefenster,
  notizText,
  passtBuchung,
  pruefZeit,
  STANDARD_FUNNEL,
  WARTEZEIT_MIN,
  type FunnelEinstellung,
  type FunnelLead,
} from "./logik";

/**
 * Funnel-Eintragungen (Perspective) → Close, PDF-Report, 10-Min.-Prüfung, Erinnerung.
 *
 * Stufen (je eigener Status in funnel_eintragungen, der minütliche WhatsApp-Cron arbeitet ab):
 * 1. Close (Schalter funnel_close_aktiv): Lead finden (E-Mail/Telefon/Domain) oder anlegen, alle Angaben als Notiz,
 *    passende Lead-Felder (gleicher Name wie die Frage, Leadquelle, UTM) füllen.
 * 2. Report (Schalter funnel_whatsapp_aktiv): PDF sofort per WhatsApp (Vorlage hs_funnel_report).
 * 3. Prüfung nach 10 Min. (Schalter funnel_close_aktiv): Termin gebucht? → sonst Close-Aufgabe „Jetzt anrufen“
 *    + Slack (Renney markiert) + Erinnerung planen.
 * 4. Erinnerung (Schalter funnel_whatsapp_aktiv): Mo–Fr 8–20 Uhr, Vorlage hs_funnel_termin mit Buchungs-Knopf —
 *    nicht, wenn inzwischen gebucht, geantwortet oder telefonisch ein Termin gelegt wurde.
 * Für WhatsApp gelten zusätzlich alle Prüfungen des Bots (Bot an bzw. Testnummer, Vorlage an + freigegeben,
 * Einwilligung, STOP).
 */

const CLOSE_TIMEOUT_MS = 10_000;
const MIN = 60_000;
/** Nach so langer Zeit wird nichts mehr nachgeholt (z. B. Schalter erst später eingeschaltet) */
const NICHT_NACHHOLEN_MS = 24 * 60 * MIN;
/** Erinnerung höchstens so lange nach der Eintragung */
const ERINNERUNG_MAX_MS = 3 * 24 * 60 * MIN;
const HAENGT_MS = 5 * MIN;

function close<T>(path: string, opts: Omit<NonNullable<Parameters<typeof closeApi>[1]>, "signal"> = {}): Promise<T> {
  return closeApi<T>(path, { ...opts, signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS) });
}

/** Geheimer URL-Token für den Webhook, abgeleitet aus CRON_SECRET (keine extra Env-Variable). */
export function funnelWebhookToken(): string | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update("perspective-webhook").digest("hex").slice(0, 32);
}

export interface Eintragung {
  id: string;
  external_id: string | null;
  funnel: string;
  funnel_name: string | null;
  token: string;
  name: string | null;
  vorname: string | null;
  firma: string | null;
  email: string | null;
  telefon: string | null;
  telefon_roh: string | null;
  opt_in: boolean;
  antworten: FunnelLead["antworten"];
  utm: Record<string, string>;
  eingetragen_am: string;
  close_status: string;
  close_versuche: number;
  close_lead_id: string | null;
  close_neu: boolean | null;
  report_status: string;
  pruefen_am: string;
  pruef_status: string;
  ergebnis: string | null;
  gebucht_am: string | null;
  aufgabe_id: string | null;
  erinnerung_am: string | null;
  erinnerung_status: string;
  geklickt_am: string | null;
  claimed_at: string | null;
  fehler: string | null;
  verlauf: Array<{ am: string; text: string }>;
}

const funnelVon = (e: FunnelEinstellungen, key: string): FunnelEinstellung =>
  e.funnels[key] ?? { ...STANDARD_FUNNEL, name: key };

// ---------------------------------------------------------------------------
// Eingang (Webhook)
// ---------------------------------------------------------------------------

/**
 * Eintragung speichern (vor der Antwort an Perspective). Doppelte Webhooks (gleiche Eintrags-ID) → duplicate.
 * Unbekannter Funnel → wird mit Standardwerten angelegt (ohne Report), damit er auf /sales/funnels erscheint.
 */
export async function speichereEintragung(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  funnelParam: string | null,
): Promise<{ id: string; duplicate: boolean } | { fehler: string }> {
  const lead = leseFunnelLead(body);
  if (!lead.email && !lead.telefon) return { fehler: "Keine E-Mail und keine Telefonnummer im Payload" };

  const key = funnelParam && /^[a-z0-9-]{1,40}$/.test(funnelParam) ? funnelParam : funnelKey(lead.funnelName);
  const einstellungen = await ladeFunnelEinstellungen(svc);
  let f = einstellungen.funnels[key];
  if (!f) {
    f = { ...STANDARD_FUNNEL, name: lead.funnelName ?? key };
    await speichereFunnelWert(svc, "funnels", { ...einstellungen.funnels, [key]: f });
  }

  const telefon = normalisiereTelefon(lead.telefon);
  const eingetragen = new Date();
  const { data, error } = await svc
    .from("funnel_eintragungen")
    .insert({
      external_id: lead.externalId ? `perspective:${lead.externalId}` : null,
      funnel: key,
      funnel_name: lead.funnelName ?? f.name,
      token: zufallsToken(),
      name: lead.name,
      vorname: lead.vorname,
      firma: lead.firma,
      email: lead.email,
      telefon,
      telefon_roh: lead.telefon,
      opt_in: !!telefon && hatEinwilligung(lead, f),
      antworten: lead.antworten,
      utm: lead.utm,
      payload: body,
      eingetragen_am: eingetragen.toISOString(),
      report_status: f.report_url ? "offen" : "keiner",
      pruefen_am: pruefZeit(eingetragen).toISOString(),
    })
    .select("id")
    .single();
  if (error?.code === "23505" && lead.externalId) {
    const { data: alt } = await svc.from("funnel_eintragungen").select("id").eq("external_id", `perspective:${lead.externalId}`).maybeSingle();
    return { id: (alt as { id: string } | null)?.id ?? "", duplicate: true };
  }
  if (error || !data) throw new Error(`Eintragung nicht gespeichert: ${error?.message}`);
  return { id: (data as { id: string }).id, duplicate: false };
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

/** Stufe übernehmen (optimistische Sperre über den bisherigen Status). */
async function beanspruche(
  svc: SupabaseClient,
  id: string,
  spalte: "close_status" | "report_status" | "pruef_status" | "erinnerung_status",
  von: string,
  extra: Record<string, unknown> = {},
): Promise<Eintragung | null> {
  const { data, error } = await svc
    .from("funnel_eintragungen")
    .update({ [spalte]: "laeuft", claimed_at: new Date().toISOString(), ...extra })
    .eq("id", id)
    .eq(spalte, von)
    .select("*");
  if (error) throw new Error(`Eintragung nicht übernommen: ${error.message}`);
  return ((data ?? []) as Eintragung[])[0] ?? null;
}

async function schreibe(svc: SupabaseClient, e: Eintragung, update: Record<string, unknown>, notiz?: string): Promise<void> {
  const verlauf = notiz ? [...(e.verlauf ?? []), { am: new Date().toISOString(), text: notiz.slice(0, 300) }].slice(-30) : undefined;
  const { error } = await svc
    .from("funnel_eintragungen")
    .update({ ...update, ...(verlauf ? { verlauf } : {}) })
    .eq("id", e.id);
  if (error) throw new Error(`Eintragung ${e.id} nicht aktualisiert: ${error.message}`);
  if (verlauf) e.verlauf = verlauf;
}

const fehlerText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/** Buchung seit der Eintragung: WhatsApp-Termine (Calendly + Close-Protokolle) und Calendly-Events */
export async function findeBuchung(svc: SupabaseClient, e: Eintragung): Promise<Date | null> {
  const ab = new Date(new Date(e.eingetragen_am).getTime() - 5 * MIN).toISOString();
  const [termine, calendly] = await Promise.all([
    svc.from("wa_termine").select("email, telefon, created_at, status").gte("created_at", ab).neq("status", "abgesagt").limit(500),
    e.email
      ? svc.from("calendly_events").select("invitee_email, created_at").gte("created_at", ab).ilike("invitee_email", e.email).limit(5)
      : Promise.resolve({ data: [] as Array<{ invitee_email: string; created_at: string }>, error: null }),
  ]);
  if (termine.error) throw new Error(`Termine nicht lesbar: ${termine.error.message}`);
  const treffer = [
    ...((termine.data ?? []) as Array<{ email: string | null; telefon: string | null; created_at: string }>),
    ...((calendly.data ?? []) as Array<{ invitee_email: string; created_at: string }>).map((c) => ({ email: c.invitee_email, telefon: null, created_at: c.created_at })),
  ]
    .filter((b) => passtBuchung(e, b))
    .map((b) => new Date(b.created_at).getTime());
  return treffer.length ? new Date(Math.min(...treffer)) : null;
}

/** Hat der Lead inzwischen eine laufende Opportunity in der Pipeline (z. B. telefonisch Termin gelegt)? */
async function hatLaufendeOpportunity(leadId: string | null): Promise<boolean> {
  if (!leadId) return false;
  const lead = await close<{ opportunities: PipelineOpp[] }>(`/lead/${leadId}/`, { params: { _fields: "opportunities" } });
  return pipelineStand(lead.opportunities ?? []).pipelineOpps.some((o) => !ABGESCHLOSSEN.has(o.status_id));
}

async function hatGeantwortet(svc: SupabaseClient, e: Eintragung): Promise<boolean> {
  if (!e.telefon) return false;
  const { count, error } = await svc
    .from("wa_nachrichten")
    .select("id", { count: "exact", head: true })
    .eq("telefon", e.telefon)
    .eq("richtung", "ein")
    .gte("created_at", e.eingetragen_am);
  if (error) throw new Error(`Nachrichten nicht lesbar: ${error.message}`);
  return (count ?? 0) > 0;
}

/** Antworten von WhatsApp (auch ohne Termin) dem Close-Lead zuordnen */
async function merkeKontakt(svc: SupabaseClient, e: Eintragung): Promise<void> {
  if (!e.telefon || !e.close_lead_id) return;
  await svc
    .from("wa_kontakte")
    .upsert({ telefon: e.telefon, close_lead_id: e.close_lead_id, updated_at: new Date().toISOString() }, { onConflict: "telefon" });
}

const wer = (e: Eintragung) => {
  const name = e.name?.trim();
  const firma = e.firma?.trim();
  if (name && firma && firma !== name) return `${name} (${firma})`;
  return name || firma || e.email || e.telefon || "Neuer Lead";
};

// ---------------------------------------------------------------------------
// Stufe 1: Close
// ---------------------------------------------------------------------------

const normFeld = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const QUELLE_FELDER = ["leadquelle", "quelle", "leadsource", "herkunft", "kanal"];

/** Felder am Lead füllen: gleiche Bezeichnung wie die Frage, Leadquelle, UTM. Einzeln (ein falscher Auswahlwert blockiert nicht alles). */
async function schreibeFelder(leadId: string, e: Eintragung, funnelName: string, neu: boolean): Promise<number> {
  const { data } = await close<{ data: Array<{ id: string; name: string; type: string }> }>("/custom_field/lead/", {
    params: { _limit: "200", _fields: "id,name,type" },
  });
  const nachName = new Map(data.map((f) => [normFeld(f.name), f]));
  const werte: Array<[string, string]> = [];
  for (const a of e.antworten) {
    const f = nachName.get(normFeld(a.frage));
    if (f) werte.push([f.id, a.antwort]);
  }
  for (const [k, v] of Object.entries(e.utm)) {
    const f = nachName.get(`utm${k}`);
    if (f) werte.push([f.id, v]);
  }
  if (neu) {
    const q = QUELLE_FELDER.map((n) => nachName.get(n)).find(Boolean);
    if (q) werte.push([q.id, `Funnel – ${funnelName}`]);
  }
  let ok = 0;
  for (const [id, wert] of werte) {
    try {
      await close(`/lead/${leadId}/`, { method: "PUT", body: { [`custom.${id}`]: wert } });
      ok++;
    } catch {
      // z. B. Auswahlfeld ohne passenden Wert → steht trotzdem in der Notiz
    }
  }
  return ok;
}

async function uebernehmeInClose(svc: SupabaseClient, e: Eintragung, f: FunnelEinstellung): Promise<{ leadId: string; neu: boolean }> {
  const funnelName = e.funnel_name ?? f.name;
  const lead: FunnelLead = {
    externalId: e.external_id,
    funnelName,
    name: e.name,
    vorname: e.vorname,
    firma: e.firma,
    email: e.email,
    telefon: e.telefon ?? e.telefon_roh,
    antworten: e.antworten ?? [],
    utm: e.utm ?? {},
    whatsappHaekchen: null,
  };
  // Lead schon in einem früheren Versuch angelegt?
  const vorhanden = e.close_lead_id ?? (await findeCloseLead(svc, { email: e.email, telefon: e.telefon }));
  if (vorhanden) {
    if (!e.close_lead_id) await notizSicher(vorhanden, notizText(lead, funnelName, true));
    await schreibeFelder(vorhanden, e, funnelName, false).catch(() => 0);
    return { leadId: vorhanden, neu: e.close_neu ?? false };
  }
  const neu = await close<{ id: string }>("/lead/", {
    method: "POST",
    body: {
      name: e.firma || e.name || e.email || e.telefon || "Funnel-Eintragung",
      contacts: [
        {
          ...(e.name ? { name: e.name } : {}),
          ...(e.email ? { emails: [{ email: e.email, type: "office" }] } : {}),
          ...(e.telefon || e.telefon_roh ? { phones: [{ phone: e.telefon ?? e.telefon_roh, type: "mobile" }] } : {}),
        },
      ],
    },
  });
  // Lead-ID sofort merken: bricht der Lauf danach ab, wird kein zweiter Lead angelegt
  await schreibe(svc, e, { close_lead_id: neu.id, close_neu: true });
  e.close_lead_id = neu.id;
  e.close_neu = true;
  await notizSicher(neu.id, notizText(lead, funnelName, false));
  await schreibeFelder(neu.id, e, funnelName, true).catch(() => 0);
  return { leadId: neu.id, neu: true };
}

async function stufeClose(svc: SupabaseClient, id: string, von: string, einst: FunnelEinstellungen): Promise<string> {
  const e = await beanspruche(svc, id, "close_status", von);
  if (!e) return "schon in Arbeit";
  try {
    const r = await uebernehmeInClose(svc, e, funnelVon(einst, e.funnel));
    await schreibe(
      svc,
      e,
      { close_status: "erledigt", close_lead_id: r.leadId, close_neu: r.neu, close_versuche: e.close_versuche + 1, fehler: null },
      r.neu ? "Lead in Close angelegt" : "Vorhandenem Close-Lead zugeordnet",
    );
    await merkeKontakt(svc, e);
    return r.neu ? "angelegt" : "zugeordnet";
  } catch (err) {
    await schreibe(svc, e, { close_status: "fehler", close_versuche: e.close_versuche + 1, fehler: fehlerText(err) }, `Close-Fehler: ${fehlerText(err)}`);
    return "fehler";
  }
}

// ---------------------------------------------------------------------------
// Stufe 2: PDF-Report
// ---------------------------------------------------------------------------

async function stufeReport(svc: SupabaseClient, id: string, einst: FunnelEinstellungen): Promise<string> {
  const e = await beanspruche(svc, id, "report_status", "offen");
  if (!e) return "schon in Arbeit";
  const f = funnelVon(einst, e.funnel);
  const ende = async (status: "gesendet" | "uebersprungen" | "fehler", text: string) => {
    await schreibe(svc, e, { report_status: status, ...(status === "fehler" ? { fehler: text } : {}) }, `Report: ${text}`);
    return text;
  };
  if (!f.report_url) return ende("uebersprungen", "kein PDF hinterlegt");
  if (!e.telefon) return ende("uebersprungen", "keine gültige Handynummer");
  if (!e.opt_in) return ende("uebersprungen", "keine WhatsApp-Einwilligung");
  if (Date.now() - new Date(e.eingetragen_am).getTime() > NICHT_NACHHOLEN_MS) return ende("uebersprungen", "Eintragung älter als 24 Std.");
  try {
    const r = await sendeFunnelVorlage(svc, {
      telefon: e.telefon,
      closeLeadId: e.close_lead_id,
      optIn: e.opt_in,
      vorlage: funnelVorlage("funnel_report"),
      werte: [metaParameter(anredeName(e.name, e.vorname, e.firma)), metaParameter(f.report_titel ?? f.name)],
      token: e.token,
      schluessel: `funnel|${e.id}|report`,
      dokument: { link: f.report_url, dateiname: f.report_dateiname ?? `${f.report_titel ?? "Report"}.pdf` },
      // Angefordertes Dokument: sofort, auch abends
      ruhezeit: false,
    });
    if (r.gesendet) return ende("gesendet", `gesendet (${r.waMessageId})`);
    // Bot/Vorlage noch aus → offen lassen, bis 24 Std. nach der Eintragung
    if (/ausgeschaltet|Bot ist aus|nicht freigegeben|nicht verbunden/.test(r.grund)) {
      await schreibe(svc, e, { report_status: "offen", claimed_at: null });
      return `wartet: ${r.grund}`;
    }
    return ende("uebersprungen", r.grund);
  } catch (err) {
    return ende("fehler", fehlerText(err));
  }
}

// ---------------------------------------------------------------------------
// Stufe 3: Prüfung nach 10 Minuten
// ---------------------------------------------------------------------------

async function stufePruefung(svc: SupabaseClient, id: string, einst: FunnelEinstellungen): Promise<string> {
  const e = await beanspruche(svc, id, "pruef_status", "offen");
  if (!e) return "schon in Arbeit";
  const f = funnelVon(einst, e.funnel);
  const funnelName = e.funnel_name ?? f.name;
  try {
    const gebucht = await findeBuchung(svc, e);
    const ergebnis = ergebnisFuer(new Date(e.eingetragen_am), gebucht);
    const zuAlt = Date.now() - new Date(e.pruefen_am).getTime() > NICHT_NACHHOLEN_MS;

    if (gebucht) {
      await schreibe(svc, e, { pruef_status: "erledigt", ergebnis, gebucht_am: gebucht.toISOString() }, "Termin direkt gebucht");
      if (!zuAlt) {
        await meldeSlack({
          emoji: "✅",
          titel: `${wer(e)} hat sich eingetragen und direkt einen Termin gebucht`,
          zeilen: [`🧲 Funnel: ${funnelName}`],
          telefon: e.telefon,
          closeLeadId: e.close_lead_id,
        });
      }
      return ergebnis;
    }
    if (zuAlt) {
      await schreibe(svc, e, { pruef_status: "erledigt", ergebnis }, "Prüfung zu spät (Schalter war aus) – keine Aufgabe");
      return "zu spät";
    }

    const aufgabe = e.close_lead_id
      ? await aufgabeAnLead(e.close_lead_id, aufgabenText(e, funnelName), { datum: berlinDatum(new Date()), zustaendig: f.zustaendig }).catch((err) => {
          console.error("[funnel] Aufgabe fehlgeschlagen:", err);
          return null;
        })
      : null;

    // WhatsApp-Erinnerung planen (Mo–Fr 8–20 Uhr)
    let erinnerung: string;
    const update: Record<string, unknown> = { pruef_status: "erledigt", ergebnis, aufgabe_id: aufgabe };
    if (!f.erinnerung) erinnerung = "WhatsApp-Erinnerung für diesen Funnel aus";
    else if (!e.telefon) erinnerung = "keine WhatsApp: keine gültige Nummer";
    else if (!e.opt_in) erinnerung = "keine WhatsApp: keine Einwilligung";
    else if (istFestnetz(e.telefon)) erinnerung = "keine WhatsApp: Festnetznummer";
    else {
      const am = naechstesSendefenster(new Date());
      update.erinnerung_status = "offen";
      update.erinnerung_am = am.toISOString();
      erinnerung = imSendefenster(new Date())
        ? "WhatsApp-Erinnerung geht jetzt raus"
        : `WhatsApp-Erinnerung ${am.toLocaleString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", minute: "2-digit" })} Uhr`;
    }
    await schreibe(svc, e, update, `Kein Termin nach ${WARTEZEIT_MIN} Min. – ${erinnerung}`);

    await meldeSlack({
      emoji: "🆕",
      erwaehnen: true,
      titel: `${wer(e)} hat sich eingetragen – muss noch terminiert werden`,
      zeilen: [
        `🧲 Funnel: ${funnelName}`,
        `⏱️ Kein Termin ${WARTEZEIT_MIN} Min. nach der Eintragung`,
        e.email ? `✉️ ${e.email}` : null,
        aufgabe ? "📝 Aufgabe „Jetzt anrufen“ in Close angelegt" : e.close_lead_id ? null : "⚠️ Noch kein Close-Lead",
        `💬 ${erinnerung}`,
      ],
      telefon: e.telefon ?? e.telefon_roh,
      closeLeadId: e.close_lead_id,
    });
    return ergebnis;
  } catch (err) {
    await schreibe(svc, e, { pruef_status: "fehler", fehler: fehlerText(err) }, `Prüfung fehlgeschlagen: ${fehlerText(err)}`);
    return "fehler";
  }
}

// ---------------------------------------------------------------------------
// Stufe 4: WhatsApp-Erinnerung „Termin buchen“
// ---------------------------------------------------------------------------

async function stufeErinnerung(svc: SupabaseClient, id: string): Promise<string> {
  const e = await beanspruche(svc, id, "erinnerung_status", "offen");
  if (!e) return "schon in Arbeit";
  const ende = async (status: "gesendet" | "uebersprungen" | "fehler", text: string, extra: Record<string, unknown> = {}) => {
    await schreibe(svc, e, { erinnerung_status: status, ...extra, ...(status === "fehler" ? { fehler: text } : {}) }, `Erinnerung: ${text}`);
    return text;
  };
  const jetzt = new Date();
  try {
    if (!imSendefenster(jetzt)) {
      await schreibe(svc, e, { erinnerung_status: "offen", erinnerung_am: naechstesSendefenster(jetzt).toISOString(), claimed_at: null });
      return "verschoben (außerhalb Mo–Fr 8–20 Uhr)";
    }
    if (jetzt.getTime() - new Date(e.eingetragen_am).getTime() > ERINNERUNG_MAX_MS) return ende("uebersprungen", "Eintragung älter als 3 Tage");
    const gebucht = await findeBuchung(svc, e);
    if (gebucht) {
      return ende("uebersprungen", "inzwischen gebucht", { gebucht_am: gebucht.toISOString(), ergebnis: ergebnisFuer(new Date(e.eingetragen_am), gebucht) });
    }
    if (await hatGeantwortet(svc, e)) return ende("uebersprungen", "Lead hat per WhatsApp geantwortet");
    if (await hatLaufendeOpportunity(e.close_lead_id)) return ende("uebersprungen", "Termin/Opportunity in Close vorhanden");
    if (!e.telefon) return ende("uebersprungen", "keine gültige Nummer");

    const r = await sendeFunnelVorlage(svc, {
      telefon: e.telefon,
      closeLeadId: e.close_lead_id,
      optIn: e.opt_in,
      vorlage: funnelVorlage("funnel_termin"),
      werte: [metaParameter(anredeName(e.name, e.vorname, e.firma))],
      token: e.token,
      schluessel: `funnel|${e.id}|termin`,
      ruhezeit: false,
    });
    if (r.gesendet) return ende("gesendet", `gesendet (${r.waMessageId})`);
    return ende("uebersprungen", r.grund);
  } catch (err) {
    return ende("fehler", err instanceof OhneWiederholung ? err.message : fehlerText(err));
  }
}

// ---------------------------------------------------------------------------
// Worker (minütlich aus dem WhatsApp-Cron)
// ---------------------------------------------------------------------------

/** Hängende Stufen (> 5 Min. „laeuft“) → fehler (Close: erneut versuchen; WhatsApp: kein Neuversand). */
async function raeumeAuf(svc: SupabaseClient): Promise<void> {
  const grenze = new Date(Date.now() - HAENGT_MS).toISOString();
  for (const spalte of ["close_status", "report_status", "pruef_status", "erinnerung_status"] as const) {
    await svc
      .from("funnel_eintragungen")
      .update({ [spalte]: "fehler", fehler: "Bearbeitung brach ab – bitte prüfen" })
      .eq(spalte, "laeuft")
      .lt("claimed_at", grenze);
  }
}

export async function verarbeiteFunnel(
  svc: SupabaseClient,
  opts: { deadline: number; nurId?: string },
): Promise<Record<string, number>> {
  const einst = await ladeFunnelEinstellungen(svc);
  const zaehler: Record<string, number> = {};
  const zaehle = (k: string) => (zaehler[k] = (zaehler[k] ?? 0) + 1);
  const zeitUebrig = () => opts.deadline - Date.now() > 15_000;
  if (!einst.closeAktiv && !einst.whatsappAktiv) return zaehler;
  if (!opts.nurId) await raeumeAuf(svc);

  const basis = () => {
    const q = svc.from("funnel_eintragungen").select("id, close_status, close_versuche, eingetragen_am, updated_at");
    return opts.nurId ? q.eq("id", opts.nurId) : q;
  };
  const jetzt = new Date().toISOString();

  if (einst.closeAktiv) {
    const vor2 = new Date(Date.now() - 2 * MIN).toISOString();
    const { data } = await basis().or(`close_status.eq.offen,and(close_status.eq.fehler,close_versuche.lt.5,updated_at.lt.${vor2})`).order("eingetragen_am").limit(10);
    for (const r of (data ?? []) as Array<{ id: string; close_status: string }>) {
      if (!zeitUebrig()) break;
      zaehle(`close_${await stufeClose(svc, r.id, r.close_status, einst)}`);
    }
  }

  if (einst.whatsappAktiv) {
    const { data } = await basis().eq("report_status", "offen").order("eingetragen_am").limit(10);
    for (const r of (data ?? []) as Array<{ id: string; close_status: string; eingetragen_am: string }>) {
      if (!zeitUebrig()) break;
      // Kurz auf den Close-Lead warten, damit die WhatsApp im Lead protokolliert wird
      if (einst.closeAktiv && r.close_status !== "erledigt" && Date.now() - new Date(r.eingetragen_am).getTime() < 3 * MIN) continue;
      zaehle(`report_${(await stufeReport(svc, r.id, einst)).split(":")[0]}`);
    }
  }

  if (einst.closeAktiv) {
    const { data } = await basis().eq("pruef_status", "offen").lte("pruefen_am", jetzt).order("pruefen_am").limit(10);
    for (const r of (data ?? []) as Array<{ id: string; close_status: string; eingetragen_am: string }>) {
      if (!zeitUebrig()) break;
      // Aufgabe braucht den Close-Lead – bis zu 30 Min. darauf warten
      if (r.close_status !== "erledigt" && Date.now() - new Date(r.eingetragen_am).getTime() < 30 * MIN) continue;
      zaehle(`pruefung_${await stufePruefung(svc, r.id, einst)}`);
    }
  }

  if (einst.whatsappAktiv) {
    const { data } = await basis().eq("erinnerung_status", "offen").lte("erinnerung_am", jetzt).order("erinnerung_am").limit(10);
    for (const r of (data ?? []) as Array<{ id: string }>) {
      if (!zeitUebrig()) break;
      zaehle(`erinnerung_${(await stufeErinnerung(svc, r.id)).split(" ")[0]}`);
    }
  }
  return zaehler;
}

/** Klick auf den Buchungs-Knopf: Eintragung zum Token, Klick merken. */
export async function eintragungPerToken(svc: SupabaseClient, token: string): Promise<Eintragung | null> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(token)) return null;
  const { data } = await svc.from("funnel_eintragungen").select("*").eq("token", token).maybeSingle();
  const e = (data as Eintragung | null) ?? null;
  if (e && !e.geklickt_am) {
    await svc.from("funnel_eintragungen").update({ geklickt_am: new Date().toISOString() }).eq("id", e.id);
  }
  return e;
}
