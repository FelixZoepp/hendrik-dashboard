/**
 * WhatsApp-Terminbot — reine Funktionen ohne I/O und ohne Imports.
 * Zeitplan, Ruhezeit, Telefon-Normalisierung, Antwort-Erkennung, Zusammenführen.
 * Wird von scripts/test-whatsapp-logik.mjs direkt mit node geprüft.
 */

export const TZ = "Europe/Berlin";

export type TerminArt = "erstgespraech" | "strategie";
export type JobTyp = "gebucht" | "erinnerung" | "unbestaetigt_check" | "gleich" | "verpasst" | "abgesagt";

const MIN = 60_000;
const STUNDE = 60 * MIN;

// ---------------------------------------------------------------------------
// Zeit in Berlin
// ---------------------------------------------------------------------------

interface BerlinTeile {
  jahr: number;
  monat: number;
  tag: number;
  stunde: number;
  minute: number;
}

export function berlinTeile(d: Date): BerlinTeile {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? "0");
  return { jahr: n("year"), monat: n("month"), tag: n("day"), stunde: n("hour") % 24, minute: n("minute") };
}

/** Zeitpunkt für eine Berliner Wanduhrzeit (berücksichtigt Sommer-/Winterzeit). */
export function berlinZeitpunkt(jahr: number, monat: number, tag: number, stunde: number, minute = 0): Date {
  const wunsch = Date.UTC(jahr, monat - 1, tag, stunde, minute);
  let t = wunsch;
  // Zweimal korrigieren reicht auch an den Umstellungstagen
  for (let i = 0; i < 2; i++) {
    const b = berlinTeile(new Date(t));
    const ist = Date.UTC(b.jahr, b.monat - 1, b.tag, b.stunde, b.minute);
    t += wunsch - ist;
  }
  return new Date(t);
}

/** "Donnerstag, 16.10." */
export function formatDatum(d: Date): string {
  const wochentag = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "long" }).format(d);
  const datum = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(d);
  return `${wochentag}, ${datum}`;
}

/** "10:30" */
export function formatUhrzeit(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/** YYYY-MM-DD in Berlin (für Close-Aufgaben). */
export function berlinDatum(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(d);
}

/** Für Erinnerungen: "heute" / "morgen" / "am Donnerstag, 16.10." */
export function erinnerungsTag(start: Date, jetzt: Date): string {
  const tag = berlinDatum(start);
  if (tag === berlinDatum(jetzt)) return "heute";
  const b = berlinTeile(jetzt);
  const morgen = berlinZeitpunkt(b.jahr, b.monat, b.tag + 1, 12);
  if (tag === berlinDatum(morgen)) return "morgen";
  return `am ${formatDatum(start)}`;
}

// ---------------------------------------------------------------------------
// Ruhezeit 21–8 Uhr (Berlin)
// ---------------------------------------------------------------------------

export const RUHE_AB = 21;
export const RUHE_BIS = 8;

export function istRuhezeit(d: Date): boolean {
  const { stunde } = berlinTeile(d);
  return stunde >= RUHE_AB || stunde < RUHE_BIS;
}

/** Nächster erlaubter Sendezeitpunkt: d selbst oder der nächste Morgen 8:00 Uhr. */
export function naechsterSendezeitpunkt(d: Date): Date {
  if (!istRuhezeit(d)) return d;
  const b = berlinTeile(d);
  const tag = b.stunde >= RUHE_AB ? b.tag + 1 : b.tag;
  return berlinZeitpunkt(b.jahr, b.monat, tag, RUHE_BIS);
}

export type RuhezeitEntscheidung =
  | { aktion: "senden" }
  | { aktion: "verschieben"; bis: Date }
  | { aktion: "ueberspringen"; grund: string };

/**
 * Ruhezeit beim Senden: auf 8:00 verschieben — außer das läge nach `spaetestens`
 * (Terminbeginn), dann überspringen. `spaetestens = null` → immer verschieben.
 */
export function ruhezeitEntscheidung(jetzt: Date, spaetestens: Date | null): RuhezeitEntscheidung {
  if (!istRuhezeit(jetzt)) return { aktion: "senden" };
  const bis = naechsterSendezeitpunkt(jetzt);
  if (spaetestens && bis.getTime() >= spaetestens.getTime()) {
    return { aktion: "ueberspringen", grund: "Ruhezeit bis nach Terminbeginn" };
  }
  return { aktion: "verschieben", bis };
}

// ---------------------------------------------------------------------------
// Zeitplan
// ---------------------------------------------------------------------------

export interface GeplanterJob {
  typ: JobTyp;
  run_at: Date;
}

/** Jobs, die mehr als so lange überfällig sind, werden nicht nachgeholt. */
export const MAX_VERSPAETUNG_MS = 15 * MIN;

/** Vorlauf der „gleich“-Nachricht: Erstgespräch 15 Min., Strategiegespräch 1 Std. */
export const GLEICH_VORLAUF_MS: Record<TerminArt, number> = {
  erstgespraech: 15 * MIN,
  strategie: STUNDE,
};

/**
 * Zeitplan eines Termins:
 * - gebucht: sofort
 * - erinnerung: Start−24h; liegt das vor jetzt+30min → Start−3h; sonst keine.
 *   Zusätzlich nur, wenn sie (nach Ruhezeit-Verschiebung) deutlich nach „gebucht“
 *   und vor „gleich“ liegt — sonst kämen zwei Nachrichten auf einmal.
 * - unbestaetigt_check: Start−2h (nur Close-Aufgabe), wenn das nach jetzt+30min liegt
 * - gleich: Start−15 Min. (Erstgespräch) bzw. Start−1h (Strategie), wenn der Termin noch
 *   mindestens Vorlauf + 10 Min. entfernt ist und sie nicht mit der (ggf. auf 8:00
 *   verschobenen) Buchungsnachricht zusammenfällt
 * Termin schon vorbei → gar nichts.
 */
export function planeZeitplan(start: Date, jetzt: Date, art: TerminArt): GeplanterJob[] {
  const s = start.getTime();
  const j = jetzt.getTime();
  if (s <= j) return [];

  const jobs: GeplanterJob[] = [{ typ: "gebucht", run_at: jetzt }];
  const gebuchtEff = naechsterSendezeitpunkt(jetzt).getTime();
  const vorlaufGleich = GLEICH_VORLAUF_MS[art];
  const gleichAt = s - vorlaufGleich;

  for (const vorlauf of [24 * STUNDE, 3 * STUNDE]) {
    const t = s - vorlauf;
    if (t < j + 30 * MIN) continue;
    const eff = naechsterSendezeitpunkt(new Date(t)).getTime();
    if (eff >= gleichAt || eff < gebuchtEff + 30 * MIN) continue;
    jobs.push({ typ: "erinnerung", run_at: new Date(t) });
    break;
  }

  const check = s - 2 * STUNDE;
  if (check >= j + 30 * MIN) jobs.push({ typ: "unbestaetigt_check", run_at: new Date(check) });

  if (s >= j + vorlaufGleich + 10 * MIN) {
    const eff = naechsterSendezeitpunkt(new Date(gleichAt)).getTime();
    if (eff < s && eff > gebuchtEff + 10 * MIN) jobs.push({ typ: "gleich", run_at: new Date(gleichAt) });
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Telefon
// ---------------------------------------------------------------------------

/** Telefonnummer in E.164 (Deutschland als Standard). null, wenn unbrauchbar. */
export function normalisiereTelefon(roh: string | null | undefined): string | null {
  if (!roh) return null;
  const sauber = String(roh).replace(/[^\d+]/g, "");
  if (!sauber) return null;
  let ziffern: string;
  if (sauber.startsWith("+")) ziffern = sauber.slice(1).replace(/\+/g, "");
  else if (sauber.startsWith("00")) ziffern = sauber.slice(2);
  else if (sauber.startsWith("0")) ziffern = `49${sauber.slice(1)}`;
  else ziffern = sauber; // WhatsApp liefert "4915112345678"
  // "+49 (0) 151 …" → führende 0 nach der Ländervorwahl entfernen
  if (ziffern.startsWith("490")) ziffern = `49${ziffern.slice(3)}`;
  if (ziffern.length < 8 || ziffern.length > 15) return null;
  return `+${ziffern}`;
}

/** Nummer für Meta (ohne "+"). */
export function waNummer(e164: string): string {
  return e164.replace(/^\+/, "");
}

// ---------------------------------------------------------------------------
// Namen
// ---------------------------------------------------------------------------

/**
 * Anrede-Name für „Guten Tag {{1}},“: vollständiger Name (Vor- + Nachname),
 * sonst Vorname, sonst Firmenname, sonst „und willkommen“ (→ „Guten Tag und willkommen,“).
 */
export function anredeName(
  name: string | null | undefined,
  vorname?: string | null,
  firma?: string | null,
): string {
  for (const kandidat of [name, vorname, firma]) {
    const t = (kandidat ?? "").replace(/\s+/g, " ").trim();
    if (t) return t;
  }
  return "und willkommen";
}

/** Vorname aus einem vollständigen Namen ("Markus Müller" → "Markus"). */
export function vornameAus(name: string | null | undefined): string | null {
  const teile = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return teile.length >= 2 ? teile[0] : null;
}

/** Meta-Parameter dürfen keine Zeilenumbrüche/Tabs/>4 Leerzeichen enthalten und nicht leer sein. */
export function metaParameter(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t || "–";
}

// ---------------------------------------------------------------------------
// Calendly-Terminarten
// ---------------------------------------------------------------------------

/**
 * Zuordnung Calendly-Terminart → art. Anpassbar: Teilstring bzw. Präfix (ohne Groß-/Kleinschreibung).
 * „15-minütiges Erstgespräch (kostenfrei)“ → erstgespraech;
 * „Strategiegespräch - HoffmannSolutions (GmbH)“ → strategie; alles andere wird ignoriert.
 */
export const CALENDLY_TERMINARTEN: Array<{ art: TerminArt; enthaelt?: string; beginntMit?: string }> = [
  { art: "erstgespraech", enthaelt: "erstgespräch" },
  { art: "strategie", beginntMit: "strategiegespräch" },
];

export function artAusCalendly(eventTypeName: string | null | undefined): TerminArt | null {
  const n = (eventTypeName ?? "").trim().toLowerCase();
  if (!n) return null;
  for (const r of CALENDLY_TERMINARTEN) {
    if (r.enthaelt && n.includes(r.enthaelt)) return r.art;
    if (r.beginntMit && n.startsWith(r.beginntMit)) return r.art;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Antwort-Erkennung
// ---------------------------------------------------------------------------

export type AntwortArt = "bestaetigen" | "verschieben" | "stop" | null;

const STOP_WOERTER = new Set(["stop", "stopp", "abmelden", "abbestellen", "austragen", "unsubscribe"]);
const JA_WOERTER = new Set([
  "ja",
  "jap",
  "jo",
  "jup",
  "passt",
  "passt so",
  "passt gut",
  "bin dabei",
  "ich bin dabei",
  "bestätigt",
  "bestätige",
  "ich bestätige",
  "ich komme",
  "komme",
  "ok",
  "okay",
  "👍",
]);

export function erkenneAntwort(text: string | null | undefined): AntwortArt {
  if (!text) return null;
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[!.,?✅👍🏻👍🏼👍🏽👍🏾👍🏿\s]+$/gu, "")
    .replace(/\s+/g, " ");
  const original = text.trim();
  if (STOP_WOERTER.has(t)) return "stop";
  if (t.includes("verschieben") || t.includes("anderen termin") || t.includes("neuen termin")) return "verschieben";
  if (t.includes("ich bin dabei") || JA_WOERTER.has(t) || /^👍/u.test(original)) return "bestaetigen";
  if (/^(ja|jap|jo)[, ]+(passt|ich bin dabei|bin dabei|ich komme|bestätigt|gerne|klar)/.test(t)) return "bestaetigen";
  return null;
}

// ---------------------------------------------------------------------------
// Zusammenführen
// ---------------------------------------------------------------------------

export interface TerminKern {
  art: TerminArt;
  quelle: "calendly" | "close";
  start_at: string;
  close_lead_id?: string | null;
  telefon?: string | null;
  email?: string | null;
}

export const ZUSAMMENFUEHREN_FENSTER_MS = 30 * MIN;

/** Gleicher Lead (Close-Lead, Telefon oder E-Mail), gleiche Art, Start ±30 Min. */
export function istGleicherTermin(a: TerminKern, b: TerminKern): boolean {
  if (a.art !== b.art) return false;
  const diff = Math.abs(new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  if (diff > ZUSAMMENFUEHREN_FENSTER_MS) return false;
  if (a.close_lead_id && b.close_lead_id && a.close_lead_id === b.close_lead_id) return true;
  if (a.telefon && b.telefon && a.telefon === b.telefon) return true;
  if (a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) return true;
  return false;
}

/** Felder, die beim Zusammenführen übernommen werden. */
export const TERMIN_FELDER = [
  "calendly_event_uri",
  "calendly_invitee_uri",
  "reschedule_url",
  "cancel_url",
  "join_url",
  "ort_text",
  "close_lead_id",
  "close_opp_id",
  "close_protokoll_id",
  "close_user_id",
  "gastgeber_name",
  "vorname",
  "name",
  "firma",
  "telefon",
  "email",
  "start_at",
  "ende_at",
] as const;

export type TerminDaten = TerminKern & Partial<Record<(typeof TERMIN_FELDER)[number], string | null>> & {
  opt_in?: boolean;
};

/**
 * Änderungen für einen bestehenden Termin aus neuen Daten.
 * Calendly hat Vorrang: Calendly-Daten überschreiben, Close-Daten füllen nur Lücken
 * (außer der bestehende Termin stammt selbst nur aus Close — dann gilt der neuere Stand).
 * opt_in bleibt erhalten, sobald eine Quelle ihn gibt.
 */
export function zusammenfuehren(
  bestehend: TerminDaten,
  neu: TerminDaten,
): { patch: Partial<TerminDaten>; startGeaendert: boolean } {
  const ueberschreiben = neu.quelle === "calendly" || bestehend.quelle === "close";
  const patch: Record<string, unknown> = {};
  for (const feld of TERMIN_FELDER) {
    const wert = neu[feld];
    if (wert === undefined || wert === null || wert === "") continue;
    const alt = bestehend[feld];
    if (alt === wert) continue;
    if (ueberschreiben || alt === undefined || alt === null || alt === "") patch[feld] = wert;
  }
  if (neu.quelle === "calendly" && bestehend.quelle !== "calendly") patch.quelle = "calendly";
  if (neu.opt_in && !bestehend.opt_in) patch.opt_in = true;

  const startGeaendert =
    typeof patch.start_at === "string" &&
    new Date(patch.start_at).getTime() !== new Date(bestehend.start_at).getTime();
  if (typeof patch.start_at === "string" && !startGeaendert) delete patch.start_at;
  return { patch: patch as Partial<TerminDaten>, startGeaendert };
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Kurzer, URL-sicherer, nicht erratbarer Token (Standard 14 Zeichen ≈ 81 Bit). */
export function zufallsToken(laenge = 14): string {
  const bytes = new Uint8Array(laenge * 2);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) {
    // Verwerfen statt Modulo-Verzerrung
    if (b >= ALPHABET.length * Math.floor(256 / ALPHABET.length)) continue;
    out += ALPHABET[b % ALPHABET.length];
    if (out.length === laenge) return out;
  }
  return out.length === laenge ? out : out + zufallsToken(laenge - out.length);
}

/** Status-Rangfolge ausgehender Nachrichten — nie zurückstufen. */
export const STATUS_RANG: Record<string, number> = {
  gesendet: 1,
  zugestellt: 2,
  gelesen: 3,
  fehlgeschlagen: 4,
};

export function darfStatusSetzen(alt: string | null | undefined, neu: string): boolean {
  if (!alt) return true;
  if (neu === "fehlgeschlagen") return alt === "gesendet";
  return (STATUS_RANG[neu] ?? 0) > (STATUS_RANG[alt] ?? 0) && alt !== "fehlgeschlagen";
}
