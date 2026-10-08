import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { closeApi } from "@/lib/integrations/close";
import { createAdminClient } from "@/lib/supabase/admin";

// Close-Webhook: Gesprächsprotokolle (Cold Call, Setting, Closing) steuern
// automatisch die Pipeline "Setter-Closer Hoffmann Solutions" und den Lead-Status.

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
  oppTerminAm: "custom.cf_I3BNybAZ6KvH3SHWjaWOo2tufWH0ylIn29vMnIU07qY",
  leadFollowUpDatum: "custom.cf_fH4FD8GddOQKC4bNedpVbmEtRfNzC7zVlLve1zIGS5Y",
  leadGesperrtBis: "custom.cf_DNwjp8sYfNgqXgBFBexHlGRN57ADeAWGR5Lojc0qEL9",
};

const OPP = {
  settingTerminiert: "stat_4p97QFLGWcJTiOLz4s1bYtWKBVQR50XaQpHUdfhe8UC",
  settingNoShow: "stat_pGAeTxZ2rkNIzksWsLHKoHJdllKUCWUuqLs4dH9edNZ",
  settingFollowUp: "stat_S4XYNlf3MhHEKnvjbiCeUYJg52iX6dFWkaWuUoFg8xE",
  closingTerminiert: "stat_KSyJfnSIxwTUu4e9gJhhjoI7zn6b2pTALKpD4MIL3q0",
  closingNoShow: "stat_dXLGmLsbyoD77vFRmaY0dDm5jPd3MMxwz291MF6gxUK",
  closingFollowUp: "stat_77oJcfWYHn8JEIIS1mvBtQdCZn1ibDtpOgI6XX1Q37Y",
  cc2Vereinbart: "stat_a8IP5oWXJtjSAsFFlZyQfmBBTgBPpktTTaX67IJe7c9",
  angebotVersendet: "stat_gtUPpOqoO1rgiamIUWB16xljZO3RWyJy6u4wFUL0ThO",
  verkauft: "stat_E7Pi9IXxDFN2ZVi4JSjMX2lVAunuiMhPziMM6rC4apn",
  verloren: "stat_7ZzzWHiE2qep8OKcGjELV6fGIIrpWgZbdYOY7tzFxdZ",
};

// Aktive Phasen der Setter-Closer-Pipeline — nur diese Opportunities werden bewegt
const PIPELINE_AKTIV = new Set([
  OPP.settingTerminiert,
  OPP.settingNoShow,
  OPP.settingFollowUp,
  OPP.closingTerminiert,
  OPP.closingNoShow,
  OPP.closingFollowUp,
  OPP.cc2Vereinbart,
  OPP.angebotVersendet,
]);

const LEAD = {
  interessiert: "stat_Aovea3A7R0A8m2vWAJF2sS7s44TM5VNldFh07t0wwqP",
  keinInteresse: "stat_1gD0nIgiioj0gVbsBH8DSQtEZuppHg54A4PIOCGtwtw",
  followUp: "stat_Zkys2rUO8HpYAUoSedsrAKBmvhl2yjyM37R8hPNoDm0",
  setting: "stat_ityX5rSG4nUeLnyzHXmPY3pu1oGLCh18lTG2xeGlHzu",
  closing: "stat_YEoiWledPo9QiondDWkVs68QBvm7NCc7UUrsge6EQCM",
  disqualifiziert: "stat_d8wp87FelzfIADu2p4nYIE1YCXsvgtpEED6osK8PQTH",
  unqualifiziert: "stat_5sAl7XILLyqYTCakLOosngsJy9dDJMaWLVhvqZYwzmC",
  kunde: "stat_X6PkUBGnxmMRurKXzybtmb3p6pGqWV7KE5RNuCWcpvV",
};

interface Aktion {
  /** Ziel-Status der Opportunity; existiert keine aktive, wird eine angelegt (außer bei Verloren) */
  opp?: string;
  /** Kalender-Datum aus dem Protokoll als "Termin am" an die Opportunity schreiben */
  termin?: boolean;
  lead?: string;
  /** Kalender-Datum als "Follow-Up Datum" am Lead setzen */
  followUpDatum?: boolean;
  /** Lead für X Monate sperren ("Gesperrt bis") */
  sperreMonate?: number;
}

// Protokoll-Typ → Feld "Nächster Schritt"/Ergebnis → Aktion
const REGELN: Record<string, Array<{ feld: string; werte: Record<string, Aktion> }>> = {
  [PROTOKOLL.coldCall]: [
    {
      feld: FIELD.ccEntscheider,
      werte: {
        "Setting vereinbart am:": { opp: OPP.settingTerminiert, termin: true, lead: LEAD.setting },
        "Interessiert - Anrufen am:": { lead: LEAD.interessiert, followUpDatum: true },
        "Kein Interesse 3M:": { lead: LEAD.keinInteresse, sperreMonate: 3 },
        "Kein Interesse 6M:": { lead: LEAD.keinInteresse, sperreMonate: 6 },
        Disqualifiziert: { lead: LEAD.disqualifiziert },
      },
    },
    {
      feld: FIELD.ccGatekeeper,
      werte: { Disqualifiziert: { lead: LEAD.disqualifiziert } },
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

interface CloseWebhookEvent {
  event?: {
    object_type?: string;
    lead_id?: string;
    data?: Record<string, unknown>;
  };
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

function findeAktion(data: Record<string, unknown>): Aktion | null {
  const regeln = REGELN[data.custom_activity_type_id as string];
  if (!regeln) return null;
  for (const { feld, werte } of regeln) {
    const aktion = werte[data[feld] as string];
    if (aktion) return aktion;
  }
  return null;
}

function inMonaten(monate: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + monate);
  return d.toISOString();
}

async function fuehreAus(leadId: string, aktion: Aktion, data: Record<string, unknown>) {
  const kalender = (data[FIELD.kalender] as string | undefined) || null;
  const gelegtAuf = (data[FIELD.gelegtAuf] as string | undefined) || null;
  const ergebnis: Record<string, unknown> = {};

  if (aktion.opp) {
    const { data: opps } = await closeApi<{ data: Array<{ id: string; status_id: string }> }>(
      "/opportunity/",
      { params: { lead_id: leadId } },
    );
    const aktive = opps.filter((o) => PIPELINE_AKTIV.has(o.status_id));

    const update: Record<string, unknown> = { status_id: aktion.opp };
    if (aktion.termin && kalender) update[FIELD.oppTerminAm] = kalender;
    if (gelegtAuf) update.user_id = gelegtAuf;

    if (aktive.length > 0) {
      for (const opp of aktive) {
        await closeApi(`/opportunity/${opp.id}/`, { method: "PUT", body: update });
      }
      ergebnis.oppVerschoben = aktive.map((o) => o.id);
    } else if (aktion.opp !== OPP.verloren) {
      const neu = await closeApi<{ id: string }>("/opportunity/", {
        method: "POST",
        body: { lead_id: leadId, ...update },
      });
      ergebnis.oppAngelegt = neu.id;
    }
  }

  const leadUpdate: Record<string, unknown> = {};
  if (aktion.lead) leadUpdate.status_id = aktion.lead;
  if (aktion.followUpDatum && kalender) leadUpdate[FIELD.leadFollowUpDatum] = kalender.slice(0, 10);
  if (aktion.sperreMonate) leadUpdate[FIELD.leadGesperrtBis] = inMonaten(aktion.sperreMonate);
  if (Object.keys(leadUpdate).length > 0) {
    await closeApi(`/lead/${leadId}/`, { method: "PUT", body: leadUpdate });
    ergebnis.lead = leadUpdate;
  }

  return ergebnis;
}

export async function POST(request: Request) {
  const body = await request.text();
  const supabase = createAdminClient();

  if (
    !verifySignature(
      body,
      request.headers.get("close-sig-timestamp"),
      request.headers.get("close-sig-hash"),
    )
  ) {
    await supabase.from("webhook_errors").insert({
      endpoint: "close",
      payload: { body: body.slice(0, 2000) },
      error: "Ungültige Signatur",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { event } = JSON.parse(body) as CloseWebhookEvent;
  const data = event?.data ?? {};

  if (event?.object_type !== "activity.custom_activity" || data.status !== "published") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const aktion = findeAktion(data);
  const leadId = (data.lead_id as string | undefined) ?? event.lead_id;
  if (!aktion || !leadId) return NextResponse.json({ ok: true, skipped: true });

  try {
    const ergebnis = await fuehreAus(leadId, aktion, data);
    return NextResponse.json({ ok: true, ...ergebnis });
  } catch (err) {
    await supabase.from("webhook_errors").insert({
      endpoint: "close",
      payload: { lead_id: leadId, activity_id: data.id },
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Update fehlgeschlagen" }, { status: 500 });
  }
}
