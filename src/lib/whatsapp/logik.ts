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

/** Mindestens so viel Restzeit muss vor jedem Job/Eingang bleiben (Meta- und Close-Zeitlimits je 10 s). */
export const MIN_REST_MS = 15_000;

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

/**
 * Telefonnummer in E.164. null, wenn unbrauchbar.
 * herkunft "eingabe" (Calendly/Close/Dashboard): Deutschland-Heuristik für Nummern ohne Vorwahl.
 * herkunft "whatsapp" (Meta-Absender wa_id, z. B. "436641234567"): immer international ohne „+“.
 */
export function normalisiereTelefon(
  roh: string | null | undefined,
  herkunft: "eingabe" | "whatsapp" = "eingabe",
): string | null {
  if (!roh) return null;
  const sauber = String(roh).replace(/[^\d+]/g, "");
  if (!sauber) return null;
  if (herkunft === "whatsapp") {
    const ziffern = sauber.replace(/\+/g, "");
    return ziffern.length >= 8 && ziffern.length <= 15 && !ziffern.startsWith("0") ? `+${ziffern}` : null;
  }
  let ziffern: string;
  if (sauber.startsWith("+")) ziffern = sauber.slice(1).replace(/\+/g, "");
  else if (sauber.startsWith("00")) ziffern = sauber.slice(2);
  else if (sauber.startsWith("0")) ziffern = `49${sauber.slice(1)}`;
  else if (sauber.startsWith("49")) ziffern = sauber; // WhatsApp liefert "4915112345678"
  // Ohne Vorwahl-Präfix: deutsche Mobilnummer ohne führende 0 ("15123456789")
  else if (sauber.startsWith("1") && sauber.length >= 10 && sauber.length <= 11) ziffern = `49${sauber}`;
  else return null;
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
  close_user_id?: string | null;
  telefon?: string | null;
  email?: string | null;
}

export const ZUSAMMENFUEHREN_FENSTER_MS = 30 * MIN;
/** Gleicher Gastgeber ohne gemeinsamen Lead: nur bei fast gleichem Start derselbe Termin. */
export const GASTGEBER_FENSTER_MS = 5 * MIN;

/** Freemail-Anbieter: Domain sagt nichts über die Firma aus (kein Abgleich per Domain). */
export const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "gmx.de",
  "gmx.net",
  "gmx.at",
  "gmx.ch",
  "web.de",
  "t-online.de",
  "outlook.com",
  "outlook.de",
  "hotmail.com",
  "hotmail.de",
  "yahoo.com",
  "yahoo.de",
  "icloud.com",
  "me.com",
  "aol.com",
  "freenet.de",
  "posteo.de",
  "mail.de",
  "online.de",
  "live.de",
  "live.com",
  "protonmail.com",
  "proton.me",
]);

/** Domain einer E-Mail in Kleinbuchstaben ("J.Acar@AlphaKlima.de" → "alphaklima.de"). */
export function emailDomain(email: string | null | undefined): string | null {
  const t = (email ?? "").trim().toLowerCase();
  const at = t.lastIndexOf("@");
  if (at < 1) return null;
  const domain = t.slice(at + 1);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/** Firmen-Domain einer E-Mail — null bei Freemail-Adressen. */
export function firmenDomain(email: string | null | undefined): string | null {
  const d = emailDomain(email);
  return d && !FREEMAIL_DOMAINS.has(d) ? d : null;
}

/**
 * Gleiche Art, Start ±30 Min. und gleicher Lead: Close-Lead, Telefon, E-Mail oder
 * Firmen-Domain der E-Mail (keine Freemail). Zusätzlich: gleicher Gastgeber (close_user_id),
 * Start ±5 Min. und mindestens einem Termin fehlt der Close-Lead.
 */
export function istGleicherTermin(a: TerminKern, b: TerminKern): boolean {
  if (a.art !== b.art) return false;
  const diff = Math.abs(new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  if (diff > ZUSAMMENFUEHREN_FENSTER_MS) return false;
  if (a.close_lead_id && b.close_lead_id && a.close_lead_id === b.close_lead_id) return true;
  if (a.telefon && b.telefon && a.telefon === b.telefon) return true;
  if (a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) return true;
  const domainA = firmenDomain(a.email);
  if (domainA && domainA === firmenDomain(b.email)) return true;
  if (
    a.close_user_id &&
    a.close_user_id === b.close_user_id &&
    diff <= GASTGEBER_FENSTER_MS &&
    (!a.close_lead_id || !b.close_lead_id)
  ) {
    return true;
  }
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
  /** Close-Lead wurde vom Bot aus der Calendly-Buchung angelegt */
  close_lead_angelegt?: boolean;
};

export interface ZusammenfuehrErgebnis {
  patch: Partial<TerminDaten>;
  /** Start hat sich geändert → geplante Jobs auf den neuen Start umrechnen ('gebucht' nie neu) */
  startGeaendert: boolean;
  /** Echte Verschiebung → Bestätigung zurücksetzen */
  bestaetigungZuruecksetzen: boolean;
  /** Einwilligung neu gewonnen (false → true) */
  optInGewonnen: boolean;
  /** Vom Bot angelegten Close-Lead in den echten Lead (aus dem Close-Protokoll) zusammenführen */
  leadZusammenfuehren: { quelle: string; ziel: string } | null;
}

/** Gleiche Quelle: ab dieser Abweichung gilt eine Startänderung als Verschiebung. */
export const VERSCHIEBUNG_GLEICHE_QUELLE_MS = 5 * MIN;
/** Zwei Quellen (Calendly + Close): bis zu dieser Abweichung derselbe Termin, keine Verschiebung. */
export const VERSCHIEBUNG_ANDERE_QUELLE_MS = 15 * MIN;

/**
 * Änderungen für einen bestehenden Termin aus neuen Daten.
 * - Calendly hat Vorrang: Calendly-Daten überschreiben, Close-Daten füllen nur Lücken
 *   (außer der bestehende Termin stammt nur aus Close oder es ist dieselbe Quelle).
 * - Einwilligung hängt an der Nummer: neue/andere Nummer → opt_in der neuen Quelle
 *   (nie ein altes true behalten). Gleiche Nummer: gleiche Quelle → neuer Stand,
 *   andere Quelle → true, sobald eine Quelle es gibt.
 * - gleicheQuelle = Treffer über calendly_event_uri bzw. close_protokoll_id.
 * - Hat der Termin eine Calendly-Buchung, überschreibt Close nie Start, Kontaktdaten oder
 *   opt_in (ein true bleibt) — Close füllt dann nur Lücken.
 * - Close-Lead: der Lead aus dem Close-Protokoll gewinnt. Hat der Bot für die Calendly-Buchung
 *   einen eigenen Lead angelegt (close_lead_angelegt) und das Protokoll nennt einen anderen,
 *   wird der Termin auf den Protokoll-Lead umgestellt und leadZusammenfuehren gesetzt.
 */
export function zusammenfuehren(
  bestehend: TerminDaten,
  neu: TerminDaten,
  gleicheQuelle = false,
): ZusammenfuehrErgebnis {
  // Calendly-Daten haben Vorrang — auch wenn der Treffer über die Close-Protokoll-ID kam
  const calendlyGeschuetzt = !!bestehend.calendly_event_uri && neu.quelle !== "calendly";
  const ueberschreiben =
    !calendlyGeschuetzt && (gleicheQuelle || neu.quelle === "calendly" || bestehend.quelle === "close");
  const patch: Record<string, unknown> = {};
  for (const feld of TERMIN_FELDER) {
    const wert = neu[feld];
    if (wert === undefined || wert === null || wert === "") continue;
    const alt = bestehend[feld];
    if (alt === wert) continue;
    if (ueberschreiben || alt === undefined || alt === null || alt === "") patch[feld] = wert;
  }
  if (neu.quelle === "calendly" && bestehend.quelle !== "calendly") patch.quelle = "calendly";

  // Close-Lead: Protokoll gewinnt gegen einen per Calendly gefundenen bzw. vom Bot angelegten Lead
  let leadZusammenfuehren: ZusammenfuehrErgebnis["leadZusammenfuehren"] = null;
  const altLead = bestehend.close_lead_id || null;
  const neuLead = neu.close_lead_id || null;
  if (altLead && neuLead && altLead !== neuLead) {
    if (neu.quelle === "close" && bestehend.quelle === "calendly" && !bestehend.close_protokoll_id) {
      patch.close_lead_id = neuLead;
      if (bestehend.close_lead_angelegt) {
        patch.close_lead_angelegt = false;
        leadZusammenfuehren = { quelle: altLead, ziel: neuLead };
      }
    } else if (neu.quelle === "calendly" && bestehend.close_protokoll_id) {
      delete patch.close_lead_id;
      if (neu.close_lead_angelegt) leadZusammenfuehren = { quelle: neuLead, ziel: altLead };
    }
  }

  // Einwilligung an die Telefonnummer binden
  const altOptIn = !!bestehend.opt_in;
  let optIn = altOptIn;
  if (typeof patch.telefon === "string") optIn = !!neu.opt_in;
  else if (neu.telefon && neu.telefon === bestehend.telefon && neu.opt_in !== undefined) {
    optIn = gleicheQuelle && !calendlyGeschuetzt ? !!neu.opt_in : altOptIn || !!neu.opt_in;
  }
  if (optIn !== altOptIn) patch.opt_in = optIn;

  let diff = 0;
  if (typeof patch.start_at === "string") {
    diff = Math.abs(new Date(patch.start_at).getTime() - new Date(bestehend.start_at).getTime());
    if (diff === 0) delete patch.start_at;
  }
  const grenze = gleicheQuelle ? VERSCHIEBUNG_GLEICHE_QUELLE_MS : VERSCHIEBUNG_ANDERE_QUELLE_MS;
  return {
    patch: patch as Partial<TerminDaten>,
    startGeaendert: diff > 0,
    bestaetigungZuruecksetzen: diff > grenze,
    optInGewonnen: optIn && !altOptIn,
    leadZusammenfuehren,
  };
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
  reserviert: 0,
  gesendet: 1,
  zugestellt: 2,
  gelesen: 3,
  fehlgeschlagen: 4,
};

export function darfStatusSetzen(alt: string | null | undefined, neu: string): boolean {
  if (!alt) return true;
  if (neu === "fehlgeschlagen") return alt === "gesendet" || alt === "reserviert";
  return (STATUS_RANG[neu] ?? 0) > (STATUS_RANG[alt] ?? 0) && alt !== "fehlgeschlagen";
}

// ---------------------------------------------------------------------------
// Versand-Regeln
// ---------------------------------------------------------------------------

/**
 * Eindeutiger Versand-Schlüssel gegen Doppel-Versand (unique in wa_nachrichten).
 * „gebucht“: einmal je Termin. Sonst: Termin, Typ und Start — nach einer Verschiebung
 * (neuer Start) darf z. B. die Erinnerung erneut kommen. Doppel zwischen Calendly und
 * Close verhindert das Zusammenführen auf EINEN Termin.
 */
export function versandSchluessel(terminId: string, typ: JobTyp, start: Date): string {
  return typ === "gebucht" ? `${terminId}|gebucht` : `${terminId}|${typ}|${start.toISOString()}`;
}

export type JobAktion =
  | { typ: JobTyp; aktion: "planen"; run_at: Date }
  | { typ: JobTyp; aktion: "abbrechen" };

/**
 * Folge-Jobs (Erinnerung, Nachfassen, gleich) nach einer Startänderung.
 * echteVerschiebung: unabhängig vom bisherigen Status neu planen (außer 'laeuft');
 * sonst (kleine Abweichung beim Zusammenführen) nur noch geplante umrechnen.
 * Jobs, die nicht mehr in den Plan passen, werden abgebrochen, sofern noch geplant.
 * „gebucht“ ist nie dabei.
 */
export function folgeJobsNachStartaenderung(
  bestehend: Array<{ typ: JobTyp; status: string }>,
  plan: GeplanterJob[],
  echteVerschiebung: boolean,
): JobAktion[] {
  const aktionen: JobAktion[] = [];
  for (const typ of ["erinnerung", "unbestaetigt_check", "gleich"] as JobTyp[]) {
    const job = bestehend.find((j) => j.typ === typ);
    const neu = plan.find((p) => p.typ === typ);
    if (neu) {
      if (!job || job.status === "geplant" || (echteVerschiebung && job.status !== "laeuft")) {
        aktionen.push({ typ, aktion: "planen", run_at: neu.run_at });
      }
    } else if (job?.status === "geplant") {
      aktionen.push({ typ, aktion: "abbrechen" });
    }
  }
  return aktionen;
}

/** „gleich“-Nachricht nur, wenn die Sendezeit höchstens 5 Min. vom Soll (Start − Vorlauf) abweicht. */
export function gleichNochPassend(start: Date, art: TerminArt, jetzt: Date): boolean {
  const soll = start.getTime() - GLEICH_VORLAUF_MS[art];
  return Math.abs(jetzt.getTime() - soll) <= 5 * MIN;
}

/**
 * Späteste Sendezeit einer Nachricht:
 * Termin-Nachrichten bis Terminbeginn; „abgesagt“ solange der Termin in der Zukunft
 * liegt oder bis 12 Std. nach der Absage; „verpasst“ bis 24 Std. nach dem Termin.
 */
export function sendeFrist(typ: JobTyp, start: Date, abgesagtAm: Date | null): Date {
  if (typ === "verpasst") return new Date(start.getTime() + 24 * STUNDE);
  if (typ === "abgesagt") {
    const nachAbsage = abgesagtAm ? abgesagtAm.getTime() + 12 * STUNDE : 0;
    return new Date(Math.max(start.getTime(), nachAbsage));
  }
  return start;
}

/** Enthält ein Close-Kalenderwert eine Uhrzeit? (reines Datum "YYYY-MM-DD" → nein) */
export function hatUhrzeit(wert: string | null | undefined): boolean {
  if (!wert) return false;
  const t = wert.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  return !Number.isNaN(new Date(t).getTime()) && /\d{2}:\d{2}/.test(t);
}

/** Nachrichtentypen ohne echten Inhalt: keine Aufgabe, keine Antwort-Erkennung. */
const OHNE_INHALT = new Set(["reaction", "system", "unsupported", "unknown", "ephemeral", "request_welcome"]);

export function istOhneInhalt(typ: string): boolean {
  return OHNE_INHALT.has(typ);
}

// ---------------------------------------------------------------------------
// Bestätigungsquote (Dashboard)
// ---------------------------------------------------------------------------

export interface QuoteWert {
  bestaetigt: number;
  von: number;
}

export interface BestaetigungsQuote {
  gesamt: QuoteWert;
  erstgespraech: QuoteWert;
  strategie: QuoteWert;
}

/**
 * Anteil bestätigter Termine an den Terminen, deren Buchungsnachricht („gebucht“) zugestellt
 * bzw. gelesen wurde. zugestellt = versand_schluessel der Nachrichten mit Status zugestellt/gelesen.
 * Abgesagte Termine zählen nicht mit.
 */
export function bestaetigungsQuote(
  termine: Array<{ id: string; art: TerminArt; status: string; bestaetigt_am: string | null }>,
  zugestellt: Set<string>,
): BestaetigungsQuote {
  const q: BestaetigungsQuote = {
    gesamt: { bestaetigt: 0, von: 0 },
    erstgespraech: { bestaetigt: 0, von: 0 },
    strategie: { bestaetigt: 0, von: 0 },
  };
  for (const t of termine) {
    if (t.status === "abgesagt") continue;
    if (!zugestellt.has(`${t.id}|gebucht`)) continue;
    for (const w of [q.gesamt, q[t.art]]) {
      w.von++;
      if (t.bestaetigt_am) w.bestaetigt++;
    }
  }
  return q;
}
