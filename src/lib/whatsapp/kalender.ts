/**
 * „In den Kalender eintragen“ für die Termin-Seite: Google, Outlook (privat + Microsoft 365), Yahoo
 * und ICS (Apple, Samsung, GMX/Web.de, Thunderbird & alle anderen) mit Erinnerung. Rein, ohne I/O.
 */

import { ORT_FALLBACK_STRATEGIE, STRATEGIE_BERATER } from "./vorlagen";
import type { TerminArt } from "./logik";

export interface KalenderTermin {
  id: string;
  art: TerminArt;
  start_at: string;
  ende_at: string | null;
  ort_text: string | null;
  join_url: string | null;
  /** Link zur Termin-Seite (wird in die Beschreibung geschrieben) */
  seitenUrl: string;
}

const DAUER_MIN: Record<TerminArt, number> = { erstgespraech: 15, strategie: 60 };

export function terminTitel(art: TerminArt): string {
  return art === "strategie"
    ? `Strategiegespräch mit ${STRATEGIE_BERATER} (Hoffmann Solutions GmbH)`
    : "Erstgespräch mit der Hoffmann Solutions GmbH";
}

export function terminOrt(t: Pick<KalenderTermin, "art" | "ort_text" | "join_url">): string {
  if (t.art === "erstgespraech") return "Telefonat – ein Handwerksberater aus unserem Team ruft Sie an";
  return t.ort_text || (t.join_url ? "Videocall" : ORT_FALLBACK_STRATEGIE);
}

function ende(t: KalenderTermin): string {
  return t.ende_at ?? new Date(new Date(t.start_at).getTime() + DAUER_MIN[t.art] * 60_000).toISOString();
}

function beschreibung(t: KalenderTermin): string {
  const teile = [
    t.art === "strategie"
      ? `Strategiegespräch mit ${STRATEGIE_BERATER} von der Hoffmann Solutions GmbH.`
      : "Kostenfreies Erstgespräch mit der Hoffmann Solutions GmbH. Ein Handwerksberater aus unserem Team ruft Sie zum Termin an.",
  ];
  if (t.join_url) teile.push(`Zum Gespräch: ${t.join_url}`);
  teile.push(`Termindetails: ${t.seitenUrl}`);
  return teile.join("\n\n");
}

/** 2026-10-16T08:30:00.000Z → 20261016T083000Z */
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function googleLink(t: KalenderTermin): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: terminTitel(t.art),
    dates: `${utc(t.start_at)}/${utc(ende(t))}`,
    details: beschreibung(t),
    location: t.join_url ?? terminOrt(t),
    ctz: "Europe/Berlin",
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

function outlookParameter(t: KalenderTermin): URLSearchParams {
  return new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: terminTitel(t.art),
    startdt: new Date(t.start_at).toISOString(),
    enddt: new Date(ende(t)).toISOString(),
    body: beschreibung(t),
    location: t.join_url ?? terminOrt(t),
  });
}

/** Outlook privat (outlook.com, Hotmail, Live) */
export function outlookLink(t: KalenderTermin): string {
  return `https://outlook.live.com/calendar/0/deeplink/compose?${outlookParameter(t).toString()}`;
}

/** Outlook geschäftlich (Microsoft 365 / Office 365) */
export function office365Link(t: KalenderTermin): string {
  return `https://outlook.office.com/calendar/0/deeplink/compose?${outlookParameter(t).toString()}`;
}

export function yahooLink(t: KalenderTermin): string {
  const q = new URLSearchParams({
    v: "60",
    title: terminTitel(t.art),
    st: utc(t.start_at),
    et: utc(ende(t)),
    desc: beschreibung(t),
    in_loc: t.join_url ?? terminOrt(t),
  });
  return `https://calendar.yahoo.com/?${q.toString()}`;
}

/** ICS-Text escapen (RFC 5545) */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Zeilen > 75 Oktette falten (RFC 5545, 3.1) */
function falte(zeile: string): string {
  const bytes = new TextEncoder().encode(zeile);
  if (bytes.length <= 75) return zeile;
  const teile: string[] = [];
  let aktuell = "";
  let laenge = 0;
  for (const zeichen of zeile) {
    const l = new TextEncoder().encode(zeichen).length;
    if (laenge + l > (teile.length ? 74 : 75)) {
      teile.push(aktuell);
      aktuell = "";
      laenge = 0;
    }
    aktuell += zeichen;
    laenge += l;
  }
  teile.push(aktuell);
  return teile.join("\r\n ");
}

export function icsDatei(t: KalenderTermin, jetzt: Date = new Date()): string {
  const vorlauf = t.art === "strategie" ? "-PT1H" : "-PT15M";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hoffmann Solutions//Terminbot//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${t.id}@hoffmannsolutions.de`,
    `DTSTAMP:${utc(jetzt.toISOString())}`,
    `DTSTART:${utc(t.start_at)}`,
    `DTEND:${utc(ende(t))}`,
    `SUMMARY:${esc(terminTitel(t.art))}`,
    `DESCRIPTION:${esc(beschreibung(t))}`,
    `LOCATION:${esc(t.join_url ?? terminOrt(t))}`,
    ...(t.join_url ? [`URL:${t.join_url}`] : []),
    "BEGIN:VALARM",
    `TRIGGER:${vorlauf}`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(terminTitel(t.art))}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(falte)
    .join("\r\n");
}
