import { createHmac, timingSafeEqual } from "crypto";
import { after, NextResponse } from "next/server";
import { ABGESCHLOSSEN, darfVorwaerts, LEAD, OPP, OPP_TERMIN_AM_FELD, pipelineStand } from "@/lib/close-pipeline";
import { closeApi } from "@/lib/integrations/close";
import { createAdminClient } from "@/lib/supabase/admin";
import { verlustgrundAusWebhook } from "@/lib/verlustgrund/automatik";
import { verarbeiteCloseProtokoll } from "@/lib/whatsapp/quellen";

// Close-Webhook: Gesprächsprotokolle (Cold Call, Setting, Closing) steuern
// automatisch die Pipeline "Setter-Closer Hoffmann Solutions" und den Lead-Status.
// Status-IDs und Rangfolge: src/lib/close-pipeline.ts (auch vom WhatsApp-Terminbot genutzt).

const PROTOKOLL = {
  coldCall: "actitype_6Ni7VfN6jGxhWfQEYLkEdK",
  setting: "actitype_41UXYctoK8pqnPD2TvTGoO",
  closing: "actitype_71sdCTlSLsK8bWiC802Bn8",
};

const FIELD = {
  ccEntscheider: "custom.cf_rYzdqWeplRWv7FFbrhgaXOhKSUxhYgopFVpUmLHFruf",
  ccGatekeeper: "custom.cf_Xxgy5VSO7ySrEAApTVz7hJTfkTd4RJ8orivHrSLe4SC",
  settingNaechsterSchritt: "custom.cf_6Kt9RVMkQiuDOXBiiTRrKg8DTwvoQn8EEBCXmaTykGZ",
  closingNaechsterSchritt: "custom.cf_9vkQK8YANMMZ3lyt0aAZbAnkAxYoB15WwM5sTyr3veM",
  kalender: "custom.cf_EpznggdfbBEro7qnHRqJ10WaPHxeo80ZndzLqbdsV81",
  gelegtAuf: "custom.cf_F5t5yfr7IWVSqPFq8sdQKwoqJFb5X5I3tCtDtF2Mg3a",
  oppTerminAm: OPP_TERMIN_AM_FELD,
  leadFollowUpDatum: "custom.cf_fH4FD8GddOQKC4bNedpVbmEtRfNzC7zVlLve1zIGS5Y",
  leadGesperrtBis: "custom.cf_DNwjp8sYfNgqXgBFBexHlGRN57ADeAWGR5Lojc0qEL9",
};

interface Aktion {
  /** Ziel-Status der Opportunity; existiert keine aktive, wird eine angelegt (außer Verkauft/Verloren) */
  opp?: string;
  /** Kalender-Datum aus dem Protokoll als "Termin am" an die Opportunity schreiben */
  termin?: boolean;
  lead?: string;
  /** Kalender-Datum als "Follow-Up Datum" am Lead setzen */
  followUpDatum?: boolean;
  /** Lead für X Monate sperren ("Gesperrt bis"), sofern im Protokoll kein Kalender-Datum steht */
  sperreMonate?: number;
  /** Nur anwenden, solange der Lead noch nicht in der Setter-Closer-Pipeline läuft */
  nurVorPipeline?: boolean;
  /** Aufgabe mit diesem Text anlegen — fällig zum Kalender-Datum, für den Protokoll-Ersteller */
  aufgabe?: string;
}

// Protokoll-Typ → Feld "Nächster Schritt"/Ergebnis → Aktion
const REGELN: Record<string, Array<{ feld: string; werte: Record<string, Aktion> }>> = {
  [PROTOKOLL.coldCall]: [
    {
      feld: FIELD.ccEntscheider,
      werte: {
        "Setting vereinbart am:": { opp: OPP.settingTerminiert, termin: true, lead: LEAD.setting },
        "Interessiert - Anrufen am:": {
          lead: LEAD.interessiert,
          followUpDatum: true,
          nurVorPipeline: true,
          aufgabe: "Rückruf: Lead ist interessiert",
        },
        "Kein Interesse 3M:": { lead: LEAD.keinInteresse, sperreMonate: 3, nurVorPipeline: true },
        "Kein Interesse 6M:": { lead: LEAD.keinInteresse, sperreMonate: 6, nurVorPipeline: true },
        Disqualifiziert: { lead: LEAD.disqualifiziert, nurVorPipeline: true },
      },
    },
    {
      feld: FIELD.ccGatekeeper,
      werte: { Disqualifiziert: { lead: LEAD.disqualifiziert, nurVorPipeline: true } },
    },
  ],
  [PROTOKOLL.setting]: [
    {
      feld: FIELD.settingNaechsterSchritt,
      werte: {
        "Closing gelegt am:": { opp: OPP.closingTerminiert, termin: true, lead: LEAD.closing },
        "No-Show": { opp: OPP.settingNoShow, lead: LEAD.setting },
        "Follow-Up vereinbart": { opp: OPP.settingFollowUp, lead: LEAD.followUp, followUpDatum: true },
        Disqualifiziert: { opp: OPP.verloren, lead: LEAD.disqualifiziert },
        "Nicht qualifiziert": { opp: OPP.verloren, lead: LEAD.unqualifiziert },
      },
    },
  ],
  [PROTOKOLL.closing]: [
    {
      feld: FIELD.closingNaechsterSchritt,
      werte: {
        "CC2 vereinbart am:": { opp: OPP.cc2Vereinbart, termin: true, lead: LEAD.closing },
        "Angebot versendet": { opp: OPP.angebotVersendet, lead: LEAD.closing },
        "No SHow": { opp: OPP.closingNoShow, lead: LEAD.closing },
        Abgeschlossen: { opp: OPP.verkauft, lead: LEAD.kunde },
        Unqualifiziert: { opp: OPP.verloren, lead: LEAD.unqualifiziert },
      },
    },
  ],
};


export const maxDuration = 60;

interface CloseWebhookEvent {
  event?: {
    object_type?: string;
    object_id?: string;
    lead_id?: string;
    data?: Record<string, unknown>;
  };
}

interface Protokoll extends Record<string, unknown> {
  id: string;
  lead_id: string;
  status: string;
  custom_activity_type_id: string;
  date_created: string;
}

interface Opportunity {
  id: string;
  status_id: string;
  date_updated: string;
}

/** Close signiert mit HMAC-SHA256(hex-Key, timestamp + body). */
function verifySignature(body: string, timestamp: string | null, hash: string | null) {
  const key = process.env.CLOSE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !timestamp || !hash) return false;
  const expected = createHmac("sha256", Buffer.from(key, "hex"))
    .update(timestamp + body)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

function findeAktion(protokoll: Record<string, unknown>): Aktion | null {
  const regeln = REGELN[protokoll.custom_activity_type_id as string];
  if (!regeln) return null;
  for (const { feld, werte } of regeln) {
    const aktion = werte[protokoll[feld] as string];
    if (aktion) return aktion;
  }
  return null;
}

/**
 * Close liefert Webhooks nicht garantiert in Reihenfolge. Gibt es zum Lead schon
 * ein neueres Protokoll mit Aktion, ist dieses veraltet und darf nichts zurückdrehen.
 */
async function istVeraltet(protokoll: Protokoll) {
  const { data: protokolle } = await closeApi<{ data: Protokoll[] }>("/activity/custom/", {
    params: { lead_id: protokoll.lead_id, date_created__gt: protokoll.date_created },
  });
  return protokolle.some(
    (p) => p.id !== protokoll.id && p.status === "published" && findeAktion(p) !== null,
  );
}

/** Datum (YYYY-MM-DD) in deutscher Zeit — für reine Datumsfelder. */
function berlinerDatum(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(iso));
}

/** Basis + X Monate, am Monatsende begrenzt (31.08. + 6 → 28./29.02.). */
function plusMonate(basisIso: string, monate: number): string {
  const d = new Date(basisIso);
  const tag = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + monate);
  const letzterTag = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(tag, letzterTag));
  return d.toISOString();
}

async function fuehreAus(protokoll: Protokoll, aktion: Aktion) {
  const leadId = protokoll.lead_id;
  const kalender = (protokoll[FIELD.kalender] as string | undefined) || null;
  const gelegtAuf = (protokoll[FIELD.gelegtAuf] as string | undefined) || null;
  const ergebnis: Record<string, unknown> = {};

  const lead = await closeApi<{ status_id: string; opportunities: Opportunity[] }>(
    `/lead/${leadId}/`,
    { params: { _fields: "status_id,opportunities" } },
  );
  // Bei mehreren laufenden Deals nur den zuletzt bearbeiteten bewegen
  const { pipelineOpps, aktiv } = pipelineStand(lead.opportunities);

  if (aktion.nurVorPipeline && (aktiv || lead.status_id === LEAD.kunde)) {
    return { skipped: "Lead läuft bereits in der Pipeline" };
  }

  if (aktion.opp) {
    if (aktiv && !darfVorwaerts(aktion.opp, aktiv.status_id)) {
      return { skipped: "Opportunity ist schon weiter" };
    }

    const update: Record<string, unknown> = { status_id: aktion.opp };
    if (aktion.termin) {
      if (kalender) update[FIELD.oppTerminAm] = kalender;
      if (gelegtAuf) update.user_id = gelegtAuf;
    }

    if (aktiv) {
      await closeApi(`/opportunity/${aktiv.id}/`, { method: "PUT", body: update });
      ergebnis.oppVerschoben = aktiv.id;
    } else if (
      // Neuer Deal nur beim Einstieg — oder wenn der Lead noch gar keinen in der Pipeline hat
      aktion.opp === OPP.settingTerminiert ||
      (pipelineOpps.length === 0 && !ABGESCHLOSSEN.has(aktion.opp))
    ) {
      const neu = await closeApi<{ id: string }>("/opportunity/", {
        method: "POST",
        body: { lead_id: leadId, ...update },
      });
      ergebnis.oppAngelegt = neu.id;
    }
  }

  const leadUpdate: Record<string, unknown> = {};
  if (aktion.lead && (lead.status_id !== LEAD.kunde || aktion.lead === LEAD.kunde)) {
    leadUpdate.status_id = aktion.lead;
  }
  if (aktion.followUpDatum && kalender) leadUpdate[FIELD.leadFollowUpDatum] = berlinerDatum(kalender);
  if (aktion.sperreMonate) {
    leadUpdate[FIELD.leadGesperrtBis] =
      kalender ?? plusMonate(protokoll.date_created, aktion.sperreMonate);
  }
  if (Object.keys(leadUpdate).length > 0) {
    await closeApi(`/lead/${leadId}/`, { method: "PUT", body: leadUpdate });
    ergebnis.lead = leadUpdate;
  }

  if (aktion.aufgabe) {
    const faellig = kalender ?? berlinerDatum(new Date().toISOString());
    // Bearbeitete Protokolle / Wiederholungen dürfen keine doppelte Aufgabe erzeugen
    const { data: offene } = await closeApi<{ data: Array<{ text: string; date: string | null }> }>(
      "/task/",
      { params: { lead_id: leadId, is_complete: "false" } },
    );
    if (!offene.some((t) => t.text === aktion.aufgabe && t.date?.slice(0, 10) === faellig.slice(0, 10))) {
      const aufgabe = await closeApi<{ id: string }>("/task/", {
        method: "POST",
        body: {
          _type: "lead",
          lead_id: leadId,
          text: aktion.aufgabe,
          date: faellig,
          assigned_to: (protokoll.user_id as string | undefined) ?? undefined,
        },
      });
      ergebnis.aufgabe = aufgabe.id;
    }
  }

  if (aktion.termin && !kalender) {
    ergebnis.warnung = "Termin ohne Kalender-Datum";
  }
  return ergebnis;
}

/**
 * WhatsApp-Terminbot: Termin aus dem Protokoll anlegen bzw. No-Show/Stattgefunden setzen.
 * Läuft zusätzlich NACH der Pipeline-Logik und darf den Close-Webhook nie scheitern lassen.
 */
async function whatsappTerminbot(
  supabase: ReturnType<typeof createAdminClient>,
  protokoll: Protokoll,
) {
  try {
    const typ = (Object.keys(PROTOKOLL) as Array<keyof typeof PROTOKOLL>).find(
      (k) => PROTOKOLL[k] === protokoll.custom_activity_type_id,
    );
    const wert = (REGELN[protokoll.custom_activity_type_id] ?? [])
      .map(({ feld, werte }) => {
        const w = protokoll[feld] as string | undefined;
        return w && werte[w] ? w : undefined;
      })
      .find((w): w is string => !!w);
    if (!typ || !wert) return;
    await verarbeiteCloseProtokoll(supabase, {
      protokoll,
      typ,
      wert,
      kalender: (protokoll[FIELD.kalender] as string | undefined) || null,
      gelegtAuf: (protokoll[FIELD.gelegtAuf] as string | undefined) || null,
    });
  } catch (err) {
    await supabase.from("webhook_errors").insert({
      endpoint: "whatsapp",
      payload: { quelle: "close", lead_id: protokoll.lead_id, activity_id: protokoll.id },
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Verlustgrund-Automatik (Schalter auf /sales/verlustgrund, Standard aus): Grund aus dem Protokoll in die
 * verlorene Opportunity übernehmen, sonst Aufgabe „Verlustgrund eintragen“. Darf den Webhook nie scheitern lassen.
 */
async function verlustgrund(
  supabase: ReturnType<typeof createAdminClient>,
  protokoll: Protokoll,
  oppId: string | null,
) {
  try {
    await verlustgrundAusWebhook(supabase, protokoll, oppId);
  } catch (err) {
    await supabase.from("webhook_errors").insert({
      endpoint: "verlustgrund",
      payload: { lead_id: protokoll.lead_id, activity_id: protokoll.id, opp_id: oppId },
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function POST(request: Request) {
  const body = await request.text();
  const supabase = createAdminClient();
  const logFehler = (payload: Record<string, unknown>, error: string) =>
    supabase.from("webhook_errors").insert({ endpoint: "close", payload, error });

  if (
    !verifySignature(
      body,
      request.headers.get("close-sig-timestamp"),
      request.headers.get("close-sig-hash"),
    )
  ) {
    await logFehler({ body: body.slice(0, 2000) }, "Ungültige Signatur");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { event } = JSON.parse(body) as CloseWebhookEvent;
  const activityId = event?.object_id ?? (event?.data?.id as string | undefined);
  if (
    event?.object_type !== "activity.custom_activity" ||
    !activityId ||
    !((event.data?.custom_activity_type_id as string) in REGELN)
  ) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    // Immer den aktuellen Stand aus Close nehmen — Webhook-Daten können veraltet sein
    const protokoll = await closeApi<Protokoll>(`/activity/custom/${activityId}/`);
    const aktion = findeAktion(protokoll);
    if (protokoll.status !== "published" || !aktion) {
      return NextResponse.json({ ok: true, skipped: true });
    }
    if (await istVeraltet(protokoll)) {
      return NextResponse.json({ ok: true, skipped: "neueres Protokoll vorhanden" });
    }

    const ergebnis = await fuehreAus(protokoll, aktion);
    // WhatsApp-Terminbot entkoppelt: Close bekommt sofort Antwort, Bot läuft danach
    after(() => whatsappTerminbot(supabase, protokoll));
    if (aktion.opp === OPP.verloren) {
      const oppId = typeof ergebnis.oppVerschoben === "string" ? ergebnis.oppVerschoben : null;
      after(() => verlustgrund(supabase, protokoll, oppId));
    }
    if (ergebnis.warnung) {
      await logFehler({ lead_id: protokoll.lead_id, activity_id: activityId }, String(ergebnis.warnung));
    }
    return NextResponse.json({ ok: true, ...ergebnis });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logFehler({ activity_id: activityId }, message);
    // Dauerhafte Fehler (z.B. Lead gelöscht) quittieren, sonst wiederholt Close 72 h lang
    const dauerhaft = /Close API error 4(?!29)\d\d/.test(message);
    return NextResponse.json(
      { error: "Update fehlgeschlagen" },
      { status: dauerhaft ? 200 : 500 },
    );
  }
}
