import type { SupabaseClient } from "@supabase/supabase-js";
import { closeBenutzerName, closeBenutzerPerEmail, feldWert, findeCloseLead, istJa, ladeLead } from "./close-log";
import { ladeEinstellungen } from "./einstellungen";
import { artAusCalendly, normalisiereTelefon, vornameAus, type TerminArt } from "./logik";
import {
  legeTerminAn,
  letzterTerminDesLeads,
  markiereStattgefunden,
  markiereVerpasst,
  sagTerminAb,
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

/** Telefonnummer aus SMS-Erinnerungsfeld, Telefon-Frage oder „Wir rufen an“-Ort. */
export function telefonAusCalendly(p: NonNullable<CalendlyWebhook["payload"]>): string | null {
  const kandidaten = [
    p.text_reminder_number,
    p.questions_and_answers?.find((qa) => TELEFON_FRAGE.test(qa.question))?.answer,
    p.scheduled_event?.location?.type === "outbound_call" ? p.scheduled_event.location.location : null,
  ];
  for (const k of kandidaten) {
    const t = normalisiereTelefon(k);
    if (t) return t;
  }
  return null;
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
    const { data } = await svc.from("wa_termine").select("*").eq("calendly_event_uri", ev.uri).maybeSingle();
    if (!data) return { ignoriert: "Termin unbekannt" };
    // Verschiebung = Absage + neue Buchung → keine „abgesagt“-Nachricht
    await sagTerminAb(svc, data as Termin, {
      nachricht: p.rescheduled !== true,
      grund: p.rescheduled ? "In Calendly verschoben" : "In Calendly abgesagt",
      jetzt,
    });
    return { aktion: p.rescheduled ? "verschoben" : "abgesagt" };
  }

  if (body.event !== "invitee.created" || !ev.start_time) return { ignoriert: body.event ?? "ohne Event" };

  const telefon = telefonAusCalendly(p);
  const email = p.email?.trim().toLowerCase() || null;
  const gastgeber = ev.event_memberships?.[0];
  const [closeLeadId, closeUserId] = await Promise.all([
    findeCloseLead(svc, { email, telefon }).catch(() => null),
    closeBenutzerPerEmail(svc, gastgeber?.user_email).catch(() => null),
  ]);

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
    close_lead_id: closeLeadId,
    close_user_id: closeUserId,
    gastgeber_name: gastgeber?.user_name ?? null,
    name: p.name?.trim() || null,
    vorname: p.first_name?.trim() || vornameAus(p.name),
    firma: p.questions_and_answers?.find((qa) => /unternehmen|firma/i.test(qa.question))?.answer?.trim() || null,
    telefon,
    email,
    // Nummer freiwillig angegeben = Einwilligung in Termin-Nachrichten
    opt_in: !!telefon,
  };
  const r = await legeTerminAn(svc, eingabe, jetzt);
  return { aktion: r.aktion, termin: r.termin.id, startGeaendert: r.startGeaendert };
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
    const termin = await letzterTerminDesLeads(svc, leadId, gespraech, jetzt);
    if (termin) {
      if (istNoShow(e.wert)) {
        await markiereVerpasst(svc, termin, jetzt);
        ergebnis.verpasst = termin.id;
      } else {
        await markiereStattgefunden(svc, termin);
        ergebnis.stattgefunden = termin.id;
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
