import type { SupabaseClient } from "@supabase/supabase-js";
import {
  closeBenutzerName,
  closeBenutzerPerEmail,
  feldWert,
  findeCloseLead,
  istJa,
  ladeLead,
  legeCloseLeadAn,
  notizSicher,
  pipelineNachBuchung,
} from "./close-log";
import { ladeEinstellungen } from "./einstellungen";
import { artAusCalendly, hatUhrzeit, normalisiereTelefon, vornameAus, type TerminArt } from "./logik";
import {
  legeAbsagePlatzhalterAn,
  leadEinesPassendenTermins,
  legeTerminAn,
  letzterTerminDesLeads,
  verpassterTerminDesLeads,
  markiereStattgefunden,
  markiereVerpasst,
  sagTerminAb,
  terminZumErgebnisProtokoll,
  type Termin,
  type TerminEingabe,
} from "./termine";

/**
 * Quellen für Termine: Calendly-Webhook und Close-Gesprächsprotokolle.
 */

// ---------------------------------------------------------------------------
// Calendly
// ---------------------------------------------------------------------------

interface CalendlyOrt {
  type?: string;
  location?: string | null;
  join_url?: string | null;
}

export interface CalendlyWebhook {
  event?: string;
  payload?: {
    uri?: string;
    name?: string;
    first_name?: string | null;
    email?: string;
    rescheduled?: boolean;
    reschedule_url?: string;
    cancel_url?: string;
    text_reminder_number?: string | null;
    questions_and_answers?: Array<{ question: string; answer: string }>;
    scheduled_event?: {
      uri?: string;
      name?: string;
      start_time?: string;
      end_time?: string;
      location?: CalendlyOrt | null;
      event_memberships?: Array<{ user_email?: string; user_name?: string }>;
    };
  };
}

const TELEFON_FRAGE = /whatsapp|handy|telefon|mobil/i;
const WHATSAPP_FRAGE = /whatsapp/i;

/**
 * Telefonnummer und Einwilligung aus einer Calendly-Buchung (Erst- oder Strategiegespräch).
 * Entscheidung Felix (13.10.): Wer beim Buchen eine Nummer angibt (Handynummer-Frage, „Wir rufen an“-Ort
 * oder SMS-Erinnerung), bekommt Bestätigung und Erinnerungen per WhatsApp → opt_in.
 * Reihenfolge: WhatsApp-Frage, andere Telefon-Frage, Anruf-Ort, SMS-Erinnerungsnummer.
 */
export function telefonAusCalendly(p: NonNullable<CalendlyWebhook["payload"]>): { telefon: string | null; optIn: boolean } {
  const kandidaten = [
    p.questions_and_answers?.find((qa) => WHATSAPP_FRAGE.test(qa.question))?.answer,
    p.questions_and_answers?.find((qa) => TELEFON_FRAGE.test(qa.question))?.answer,
    p.scheduled_event?.location?.type === "outbound_call" ? p.scheduled_event.location.location : null,
    p.text_reminder_number,
  ];
  for (const k of kandidaten) {
    const t = normalisiereTelefon(k);
    if (t) return { telefon: t, optIn: true };
  }
  return { telefon: null, optIn: false };
}

/** Alle Telefonnummern einer Calendly-Buchung (normalisiert, ohne Doppelte) — für die Lead-Suche in Close. */
export function alleTelefoneAusCalendly(p: NonNullable<CalendlyWebhook["payload"]>): string[] {
  const kandidaten = [
    ...(p.questions_and_answers ?? []).filter((qa) => TELEFON_FRAGE.test(qa.question)).map((qa) => qa.answer),
    p.scheduled_event?.location?.type === "outbound_call" ? p.scheduled_event.location.location : null,
    p.text_reminder_number,
  ];
  return [...new Set(kandidaten.map((k) => normalisiereTelefon(k)).filter((t): t is string => !!t))];
}

/** Lesbarer Ort für {{4}} im Strategiegespräch. */
export function ortAusCalendly(ort: CalendlyOrt | null | undefined): string | null {
  if (!ort?.type) return null;
  const video: Record<string, string> = {
    zoom: "Videocall über Zoom",
    zoom_conference: "Videocall über Zoom",
    google_conference: "Videocall über Google Meet",
    microsoft_teams_conference: "Videocall über Microsoft Teams",
    webex_conference: "Videocall über Webex",
    gotomeeting: "Videocall über GoTo Meeting",
  };
  if (video[ort.type]) return video[ort.type];
  if (ort.type === "outbound_call") return "Telefonat – wir rufen Sie an";
  if (ort.type === "inbound_call") return ort.location ? `Telefonat – bitte rufen Sie ${ort.location} an` : "Telefonat";
  if (ort.location && !/^https?:\/\//.test(ort.location)) return ort.location;
  return ort.join_url || ort.location ? "Videocall" : null;
}

export async function verarbeiteCalendly(
  svc: SupabaseClient,
  body: CalendlyWebhook,
  jetzt: Date = new Date(),
): Promise<Record<string, unknown>> {
  const p = body.payload;
  const ev = p?.scheduled_event;
  if (!p || !ev?.uri) return { ignoriert: "ohne scheduled_event" };
  const art = artAusCalendly(ev.name);
  if (!art) return { ignoriert: `Terminart „${ev.name ?? "?"}“ nicht zugeordnet` };

  if (body.event === "invitee.canceled") {
    const { data, error } = await svc.from("wa_termine").select("*").eq("calendly_event_uri", ev.uri).maybeSingle();
    if (error) throw new Error(`Terminsuche fehlgeschlagen: ${error.message}`);
    if (!data) {
      // Absage vor der Buchung angekommen → Platzhalter, damit „created“ den Termin nicht anlegt
      await legeAbsagePlatzhalterAn(
        svc,
        { art, calendly_event_uri: ev.uri, start_at: new Date(ev.start_time ?? jetzt).toISOString() },
        jetzt,
      );
      return { aktion: "absage_vorgemerkt" };
    }
    // Verschiebung = Absage + neue Buchung → keine „abgesagt“-Nachricht
    await sagTerminAb(svc, data as Termin, {
      nachricht: p.rescheduled !== true,
      grund: p.rescheduled ? "In Calendly verschoben" : "In Calendly abgesagt",
      jetzt,
    });
    return { aktion: p.rescheduled ? "verschoben" : "abgesagt" };
  }

  if (body.event !== "invitee.created" || !ev.start_time) return { ignoriert: body.event ?? "ohne Event" };

  const { telefon, optIn } = telefonAusCalendly(p);
  const email = p.email?.trim().toLowerCase() || null;
  const gastgeber = ev.event_memberships?.[0];
  const [gefundenerLead, closeUserId] = await Promise.all([
    findeCloseLead(svc, { email, telefon, telefone: alleTelefoneAusCalendly(p) }).catch(() => null),
    closeBenutzerPerEmail(svc, gastgeber?.user_email).catch(() => null),
  ]);
  const name = p.name?.trim() || null;
  const firma = p.questions_and_answers?.find((qa) => /unternehmen|firma/i.test(qa.question))?.answer?.trim() || null;

  const eingabe: TerminEingabe = {
    art,
    quelle: "calendly",
    start_at: new Date(ev.start_time).toISOString(),
    ende_at: ev.end_time ? new Date(ev.end_time).toISOString() : null,
    calendly_event_uri: ev.uri,
    calendly_invitee_uri: p.uri ?? null,
    reschedule_url: p.reschedule_url ?? null,
    cancel_url: p.cancel_url ?? null,
    join_url: ev.location?.join_url ?? null,
    ort_text: ortAusCalendly(ev.location),
    close_lead_id: gefundenerLead,
    close_user_id: closeUserId,
    gastgeber_name: gastgeber?.user_name ?? null,
    name,
    vorname: p.first_name?.trim() || vornameAus(p.name),
    firma,
    telefon,
    email,
    // Einwilligung: Nummer beim Buchen angegeben
    opt_in: optIn,
  };

  // Kein Lead in Close → anlegen, außer ein passender Termin (Wiederholung, Close-Protokoll) kennt schon einen
  const logFehler = (aktion: string, err: unknown) =>
    svc.from("webhook_errors").insert({
      endpoint: "calendly",
      payload: { aktion, scheduled_event: ev.uri },
      error: err instanceof Error ? err.message : String(err),
    });
  if (!eingabe.close_lead_id) {
    try {
      eingabe.close_lead_id = await leadEinesPassendenTermins(svc, eingabe);
      if (!eingabe.close_lead_id) {
        eingabe.close_lead_id = await legeCloseLeadAn({ art, name, firma, email, telefon });
        eingabe.close_lead_angelegt = true;
      }
    } catch (err) {
      // Termin trotzdem anlegen (ohne Lead)
      await logFehler("close_lead_anlegen", err);
    }
  }

  const r = await legeTerminAn(svc, eingabe, jetzt);
  const ergebnis: Record<string, unknown> = { aktion: r.aktion, termin: r.termin.id, startGeaendert: r.startGeaendert };
  if (eingabe.close_lead_angelegt) ergebnis.leadAngelegt = eingabe.close_lead_id;

  // Pipeline in Close (best effort): neu, verschoben oder noch ohne Opportunity
  const t = r.termin;
  if (r.aktion !== "inaktiv" && t.close_lead_id && (r.aktion === "neu" || r.startGeaendert || !t.close_opp_id)) {
    try {
      const pipeline = await pipelineNachBuchung({ leadId: t.close_lead_id, art: t.art, startAt: t.start_at, userId: t.close_user_id });
      ergebnis.pipeline = pipeline.aktion;
      if (pipeline.oppId !== t.close_opp_id) {
        const { error } = await svc.from("wa_termine").update({ close_opp_id: pipeline.oppId }).eq("id", t.id);
        if (error) throw new Error(`Opportunity nicht am Termin gespeichert: ${error.message}`);
      }
    } catch (err) {
      await logFehler("close_pipeline", err);
    }
  }
  return ergebnis;
}

// ---------------------------------------------------------------------------
// Close-Gesprächsprotokolle
// ---------------------------------------------------------------------------

export interface CloseProtokollEreignis {
  protokoll: Record<string, unknown> & { id: string; lead_id: string; user_id?: string };
  typ: "coldCall" | "setting" | "closing";
  /** Gewählter Wert im Feld „Nächster Schritt“/Ergebnis */
  wert: string;
  kalender: string | null;
  gelegtAuf: string | null;
}

const istNoShow = (wert: string) => wert.toLowerCase().replace(/[^a-z]/g, "") === "noshow";

export async function verarbeiteCloseProtokoll(
  svc: SupabaseClient,
  e: CloseProtokollEreignis,
  jetzt: Date = new Date(),
): Promise<Record<string, unknown>> {
  const leadId = e.protokoll.lead_id;
  const ergebnis: Record<string, unknown> = {};

  // Protokoll zum Gespräch selbst → Termin verpasst bzw. stattgefunden
  const gespraech: TerminArt | null = e.typ === "setting" ? "erstgespraech" : e.typ === "closing" ? "strategie" : null;
  if (gespraech) {
    // Zuordnung Protokoll → Termin ist dauerhaft (ergebnis_protokoll_id): Wiederholung = No-Op
    const zugeordnet = await terminZumErgebnisProtokoll(svc, e.protokoll.id);
    if (zugeordnet) {
      // Nachträglich auf No-Show geändert → noch nachholen; alles andere bleibt
      if (istNoShow(e.wert) && zugeordnet.status === "stattgefunden") {
        await markiereVerpasst(svc, zugeordnet, e.protokoll.id, jetzt);
        ergebnis.verpasst = zugeordnet.id;
      } else {
        ergebnis.bereitsZugeordnet = zugeordnet.id;
      }
    } else {
      const termin = await letzterTerminDesLeads(svc, leadId, gespraech, jetzt);
      if (termin && istNoShow(e.wert)) {
        await markiereVerpasst(svc, termin, e.protokoll.id, jetzt);
        ergebnis.verpasst = termin.id;
      } else if (termin) {
        await markiereStattgefunden(svc, termin, e.protokoll.id);
        ergebnis.stattgefunden = termin.id;
      } else if (!istNoShow(e.wert)) {
        // Neues Protokoll korrigiert ein voreiliges No-Show (z. B. erst „No-Show“, dann „Closing gelegt“)
        const verpasst = await verpassterTerminDesLeads(svc, leadId, gespraech, jetzt);
        if (verpasst) {
          await markiereStattgefunden(svc, verpasst, e.protokoll.id);
          ergebnis.korrigiert = verpasst.id;
        }
      }
    }
  }

  // Neuer Termin gelegt
  const neueArt: TerminArt | null =
    e.typ === "coldCall" && e.wert === "Setting vereinbart am:"
      ? "erstgespraech"
      : e.typ === "setting" && e.wert === "Closing gelegt am:"
        ? "strategie"
        : null;
  if (!neueArt) return ergebnis;
  if (!e.kalender || Number.isNaN(new Date(e.kalender).getTime())) {
    return { ...ergebnis, warnung: "Termin ohne Kalender-Datum" };
  }
  if (!hatUhrzeit(e.kalender)) {
    await notizSicher(leadId, "WhatsApp nicht gesendet: Termin ohne Uhrzeit");
    return { ...ergebnis, warnung: "Termin ohne Uhrzeit" };
  }

  const [lead, einstellungen, gastgeberName] = await Promise.all([
    ladeLead(leadId),
    ladeEinstellungen(svc),
    closeBenutzerName(svc, e.gelegtAuf),
  ]);
  const kontakt = lead.contacts?.[0];
  const telefon =
    (kontakt?.phones ?? []).map((ph) => normalisiereTelefon(ph.phone)).find((t): t is string => !!t) ?? null;
  const feld = einstellungen.close_optin_feld;
  const einwilligung = feld
    ? [feldWert(e.protokoll, feld), feldWert(lead, feld), feldWert(kontakt, feld)].find((w) => w !== undefined && w !== null)
    : undefined;

  const r = await legeTerminAn(
    svc,
    {
      art: neueArt,
      quelle: "close",
      start_at: new Date(e.kalender).toISOString(),
      close_lead_id: leadId,
      close_protokoll_id: e.protokoll.id,
      close_user_id: e.gelegtAuf ?? e.protokoll.user_id ?? null,
      gastgeber_name: gastgeberName,
      name: kontakt?.name?.trim() || null,
      vorname: vornameAus(kontakt?.name),
      firma: lead.display_name?.trim() || null,
      telefon,
      email: kontakt?.emails?.[0]?.email?.trim().toLowerCase() || null,
      opt_in: !!telefon && istJa(einwilligung),
    },
    jetzt,
  );
  return { ...ergebnis, aktion: r.aktion, termin: r.termin.id, startGeaendert: r.startGeaendert };
}
