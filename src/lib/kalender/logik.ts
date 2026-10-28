/**
 * Kalender verbinden — reine Logik ohne I/O (scripts/test-kalender.mjs lädt die Datei direkt mit Node).
 *
 * Abo-URL je Firma: <basis>/api/kalender/<token>.ics  (Token = 32 Zufallsbytes, base64url, 43 Zeichen)
 * Der Feed enthält nur Name, Telefon und Anliegen des Leads — keine Adresse, keine E-Mail, keine Notizen.
 */

export const TZ = "Europe/Berlin";

/** Token-Format: base64url, mindestens 32 Zeichen. */
const TOKEN_MUSTER = /^[A-Za-z0-9_-]{32,128}$/;

export function istKalenderToken(wert: string | null | undefined): wert is string {
  return typeof wert === "string" && TOKEN_MUSTER.test(wert);
}

/** Letztes Pfadsegment „<token>.ics“ (oder ohne Endung) → Token, sonst null. */
export function tokenAusSegment(segment: string | null | undefined): string | null {
  if (!segment) return null;
  let s = segment;
  try {
    s = decodeURIComponent(s);
  } catch {
    return null;
  }
  if (s.toLowerCase().endsWith(".ics")) s = s.slice(0, -4);
  return istKalenderToken(s) ? s : null;
}

export interface AboLinks {
  /** https-URL (zum Kopieren, Outlook, alle anderen) */
  https: string;
  /** webcal://-URL (Apple/iPhone öffnet damit direkt „Abonnieren“) */
  webcal: string;
  google: string;
  apple: string;
  outlook: string;
}

export function aboLinks(basisUrl: string, token: string, name = "Anfragen & Termine"): AboLinks {
  const basis = basisUrl.replace(/\/+$/, "");
  const https = `${basis}/api/kalender/${token}.ics`;
  const webcal = https.replace(/^https?:\/\//i, "webcal://");
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    apple: webcal,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(name)}`,
  };
}

/** Eigener Buchungslink: leer = löschen, sonst gültige https-URL (max. 500 Zeichen). */
export function pruefeBuchungslink(eingabe: string | null | undefined): { wert: string | null; fehler: string | null } {
  const text = (eingabe ?? "").trim();
  if (!text) return { wert: null, fehler: null };
  if (text.length > 500) return { wert: null, fehler: "Der Link ist zu lang." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { wert: null, fehler: "Bitte den ganzen Link einfügen, z. B. https://calendly.com/dein-name" };
  }
  if (url.protocol !== "https:") return { wert: null, fehler: "Der Link muss mit https:// beginnen." };
  if (!url.hostname.includes(".") || url.username || url.password) {
    return { wert: null, fehler: "Das sieht nicht nach einem Buchungslink aus." };
  }
  return { wert: url.toString(), fehler: null };
}

/** Text zum Kopieren („Termin-Link senden“) — wird NUR kopiert, nie automatisch verschickt. */
export function terminLinkText(vorname: string | null | undefined, link: string, firmenName?: string | null): string {
  const name = (vorname ?? "").trim();
  const gruss = name ? `Hallo ${name},` : "Hallo,";
  const absender = firmenName?.trim() ? `\n\nViele Grüße\n${firmenName.trim()}` : "";
  return `${gruss} hier können Sie sich direkt einen passenden Termin aussuchen:\n${link}${absender}`;
}

// ---------------------------------------------------------------------------
// ICS-Feed
// ---------------------------------------------------------------------------

export type FeedTerminArt = "vor_ort" | "telefon" | "video";

export interface FeedTermin {
  id: string;
  leadId: string;
  art: FeedTerminArt;
  beginn: string;
  status: string;
  name: string;
  telefon: string | null;
  anliegen: string | null;
  geaendert?: string | null;
}

export interface FeedRueckruf {
  leadId: string;
  am: string;
  name: string;
  telefon: string | null;
  anliegen: string | null;
}

export interface FeedEingabe {
  firmenName: string;
  basisUrl: string;
  termine: FeedTermin[];
  rueckrufe: FeedRueckruf[];
  jetzt?: Date;
}

/** Diese Termine erscheinen nicht im Kalender (wurden ersetzt bzw. finden nicht statt). */
export const AUSGEBLENDETE_TERMIN_STATUS = ["abgesagt", "verschoben"] as const;

const DAUER_MIN: Record<FeedTerminArt, number> = { vor_ort: 60, telefon: 15, video: 30 };
const ART_TITEL: Record<FeedTerminArt, string> = { vor_ort: "Termin vor Ort", telefon: "Telefontermin", video: "Videotermin" };
const RUECKRUF_MIN = 15;

/** ICS-Text escapen (RFC 5545) */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Zeilen > 75 Oktette falten (RFC 5545, 3.1) */
export function falte(zeile: string): string {
  const enc = new TextEncoder();
  if (enc.encode(zeile).length <= 75) return zeile;
  const teile: string[] = [];
  let aktuell = "";
  let laenge = 0;
  for (const zeichen of zeile) {
    const l = enc.encode(zeichen).length;
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

/** 2026-10-16T08:30:00.000Z → 20261016T083000Z */
export function utcStempel(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const BERLIN = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Ortszeit Berlin im ICS-Format (für DTSTART;TZID=Europe/Berlin): 20261016T103000 */
export function berlinStempel(d: Date): string {
  const t: Record<string, string> = {};
  for (const p of BERLIN.formatToParts(d)) t[p.type] = p.value;
  return `${t.year}${t.month}${t.day}T${t.hour}${t.minute}${t.second}`;
}

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${TZ}`,
  `X-LIC-LOCATION:${TZ}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

function beschreibung(telefon: string | null, anliegen: string | null, link: string): string {
  const teile: string[] = [];
  if (telefon) teile.push(`Telefon: ${telefon}`);
  if (anliegen?.trim()) teile.push(`Anliegen: ${anliegen.trim().slice(0, 500)}`);
  teile.push(`In der Cloud öffnen: ${link}`);
  return teile.join("\n");
}

function ereignis(e: {
  uid: string;
  start: Date;
  minuten: number;
  titel: string;
  text: string;
  url: string;
  stempel: string;
  geaendert?: string | null;
}): string[] {
  const ende = new Date(e.start.getTime() + e.minuten * 60_000);
  const geaendert = e.geaendert && !Number.isNaN(Date.parse(e.geaendert)) ? utcStempel(new Date(e.geaendert)) : null;
  return [
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${e.stempel}`,
    ...(geaendert ? [`LAST-MODIFIED:${geaendert}`] : []),
    `DTSTART;TZID=${TZ}:${berlinStempel(e.start)}`,
    `DTEND;TZID=${TZ}:${berlinStempel(ende)}`,
    `SUMMARY:${icsText(e.titel)}`,
    `DESCRIPTION:${icsText(e.text)}`,
    `URL:${e.url}`,
    "TRANSP:OPAQUE",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(e.titel)}`,
    "END:VALARM",
    "END:VEVENT",
  ];
}

const gueltig = (iso: string) => !Number.isNaN(Date.parse(iso));

/** Kompletter VCALENDAR-Feed (CRLF, gefaltet). */
export function icsFeed(e: FeedEingabe): string {
  const jetzt = e.jetzt ?? new Date();
  const stempel = utcStempel(jetzt);
  const basis = e.basisUrl.replace(/\/+$/, "");
  const name = e.firmenName.trim() ? `${e.firmenName.trim()} – Anfragen & Termine` : "Anfragen & Termine";
  const zeilen: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hoffmann Solutions//Cloud Kalender//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(name)}`,
    `X-WR-TIMEZONE:${TZ}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...VTIMEZONE,
  ];

  for (const t of e.termine) {
    if ((AUSGEBLENDETE_TERMIN_STATUS as readonly string[]).includes(t.status) || !gueltig(t.beginn)) continue;
    const art: FeedTerminArt = t.art in DAUER_MIN ? t.art : "vor_ort";
    const vorsatz = t.status === "nicht_erschienen" ? "Nicht erschienen – " : "";
    zeilen.push(
      ...ereignis({
        uid: `termin-${t.id}@hoffmann-solutions-cloud`,
        start: new Date(t.beginn),
        minuten: DAUER_MIN[art],
        titel: `${vorsatz}${ART_TITEL[art]}: ${t.name || "Anfrage"}`,
        text: beschreibung(t.telefon, t.anliegen, `${basis}/leads/${t.leadId}`),
        url: `${basis}/leads/${t.leadId}`,
        stempel,
        geaendert: t.geaendert,
      }),
    );
  }

  for (const r of e.rueckrufe) {
    if (!gueltig(r.am)) continue;
    zeilen.push(
      ...ereignis({
        uid: `rueckruf-${r.leadId}@hoffmann-solutions-cloud`,
        start: new Date(r.am),
        minuten: RUECKRUF_MIN,
        titel: `Rückruf: ${r.name || "Anfrage"}`,
        text: beschreibung(r.telefon, r.anliegen, `${basis}/leads/${r.leadId}`),
        url: `${basis}/leads/${r.leadId}`,
        stempel,
      }),
    );
  }

  zeilen.push("END:VCALENDAR", "");
  return zeilen.map(falte).join("\r\n");
}
