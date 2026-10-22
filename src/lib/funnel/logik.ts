/**
 * Funnel-Eintragungen (reine Logik, ohne Imports — das node-Prüfskript lädt die Datei direkt).
 *
 * Perspective schickt pro Eintragung einen Webhook ({ id, funnelName, profile: { feld: { value, title } } }).
 * Daraus wird ein Close-Lead (alle Angaben als Notiz + passende Felder), ggf. der PDF-Report per WhatsApp,
 * und 10 Minuten später die Prüfung „Termin gebucht?“ → sonst Aufgabe + Slack + WhatsApp-Erinnerung
 * (werktags 8–20 Uhr).
 */

export const WARTEZEIT_MIN = 10;
const MIN = 60_000;
const TZ = "Europe/Berlin";

/** Versandfenster der Erinnerung: Mo–Fr 8:00–20:00 (Berlin) */
export const SENDEFENSTER = { von: 8, bis: 20 };

export interface FunnelEinstellung {
  /** Anzeigename */
  name: string;
  /** PDF für den Report-Versand (öffentliche https-URL) – null = Funnel ohne Report */
  report_url: string | null;
  /** Titel des Reports in der Nachricht („Ihr Report ‚…‘“) */
  report_titel: string | null;
  /** Dateiname, den der Lead in WhatsApp sieht */
  report_dateiname: string | null;
  /** Buchungslink (Calendly) für den Knopf – null = allgemeiner Erstgespräch-Link */
  buchungslink: string | null;
  /** WhatsApp-Erinnerung „Termin buchen“ nach 10 Min. ohne Buchung */
  erinnerung: boolean;
  /** Ohne WhatsApp-Häkchen im Funnel gilt die Angabe der Handynummer als Einwilligung */
  einwilligung_ohne_haekchen: boolean;
  /** Close-Benutzer für die Aufgabe „anrufen“ (user_…) – null = nicht zugewiesen */
  zustaendig: string | null;
}

export const STANDARD_FUNNEL: FunnelEinstellung = {
  name: "",
  report_url: null,
  report_titel: null,
  report_dateiname: null,
  buchungslink: null,
  erinnerung: true,
  einwilligung_ohne_haekchen: false,
  zustaendig: null,
};

const https = (x: unknown) => (typeof x === "string" && /^https:\/\/\S+$/.test(x.trim()) ? x.trim() : null);
const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 200) : null);

/** Einstellungen aus wa_einstellungen.funnels (jsonb) lesen – fehlerhafte Werte → Standard */
export function leseFunnels(roh: unknown): Record<string, FunnelEinstellung> {
  const out: Record<string, FunnelEinstellung> = {};
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return out;
  for (const [key, w] of Object.entries(roh as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{1,40}$/.test(key) || !w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    out[key] = {
      name: text(o.name) ?? key,
      report_url: https(o.report_url),
      report_titel: text(o.report_titel),
      report_dateiname: text(o.report_dateiname),
      buchungslink: https(o.buchungslink),
      erinnerung: o.erinnerung !== false,
      einwilligung_ohne_haekchen: o.einwilligung_ohne_haekchen === true,
      zustaendig: typeof o.zustaendig === "string" && /^user_\w+$/.test(o.zustaendig) ? o.zustaendig : null,
    };
  }
  return out;
}

/** „Hoffmann – Report Neukunden!“ → „hoffmann-report-neukunden“ */
export function funnelKey(roh: string | null | undefined): string {
  const k = (roh ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return k || "funnel";
}

// ---------------------------------------------------------------------------
// Payload lesen
// ---------------------------------------------------------------------------

export interface FunnelLead {
  externalId: string | null;
  funnelName: string | null;
  name: string | null;
  vorname: string | null;
  firma: string | null;
  email: string | null;
  telefon: string | null;
  /** Alle übrigen Angaben (Frage → Antwort), in Reihenfolge des Funnels */
  antworten: Array<{ frage: string; antwort: string }>;
  utm: Record<string, string>;
  /** Häkchen „per WhatsApp“: true/false, null = kein solches Feld im Funnel */
  whatsappHaekchen: boolean | null;
}

function wert(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(wert).filter(Boolean).join(", ") || null;
  if (v && typeof v === "object" && "value" in v) return wert((v as { value: unknown }).value);
  return null;
}

const norm = (k: string) => k.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

const KONTAKT = {
  vorname: ["firstname", "vorname"],
  nachname: ["lastname", "nachname"],
  name: ["name", "fullname", "vollername", "ihrname"],
  email: ["email", "mail", "emailadresse", "ihreemail", "ihreemailadresse"],
  telefon: ["phone", "telefon", "telefonnummer", "phonenumber", "handynummer", "mobilnummer", "mobil", "handy", "whatsappnummer", "ihretelefonnummer"],
  firma: ["company", "firma", "firmenname", "unternehmen", "betrieb", "companyname", "nameihresbetriebs", "nameihresunternehmens"],
};
const ALLE_KONTAKT = new Set(Object.values(KONTAKT).flat());

/** Wahr/falsch einer Checkbox-Antwort (null = unklar) */
export function istZustimmung(antwort: string | null | undefined): boolean | null {
  const a = (antwort ?? "").trim().toLowerCase();
  if (!a) return null;
  if (/^(nein|no|false|0|off|unchecked)$/.test(a) || /\bnicht\b|\bkein\b/.test(a)) return false;
  if (/^(ja|yes|true|1|on|checked|x|✓|✔)$/.test(a) || /zustimm|stimme|einverstanden|akzeptier|willig|ja,|bitte|gerne|per whatsapp/.test(a)) return true;
  return null;
}

/** Perspective-Payload ({ id, funnelName, profile }) oder flachen Body lesen */
export function leseFunnelLead(body: Record<string, unknown>): FunnelLead {
  const profile = (body.profile && typeof body.profile === "object" ? body.profile : body) as Record<string, unknown>;
  const felder = Object.entries(profile).map(([k, v]) => ({
    key: k,
    n: norm(k),
    titel: v && typeof v === "object" && !Array.isArray(v) && "title" in v ? wert((v as { title: unknown }).title) : null,
    wert: wert(v),
  }));
  const finde = (keys: string[]) => {
    for (const f of felder) if (f.wert && (keys.includes(f.n) || (f.titel && keys.includes(norm(f.titel))))) return f.wert;
    for (const k of keys) {
      const direkt = Object.entries(body).find(([bk]) => norm(bk) === k);
      const w = direkt ? wert(direkt[1]) : null;
      if (w) return w;
    }
    return null;
  };

  const vorname = finde(KONTAKT.vorname);
  const nachname = finde(KONTAKT.nachname);
  const name = [vorname, nachname].filter(Boolean).join(" ") || finde(KONTAKT.name);

  const utm: Record<string, string> = {};
  const antworten: FunnelLead["antworten"] = [];
  let whatsappHaekchen: boolean | null = null;
  for (const f of felder) {
    if (!f.wert) continue;
    const frage = f.titel ?? f.key;
    if (f.n.startsWith("utm")) {
      // Perspective schickt manchmal die Beschriftung („UTM Source“) statt eines Werts
      if (!/^utm[\s_]/i.test(f.wert)) utm[f.n.replace(/^utm/, "")] = f.wert.slice(0, 200);
      continue;
    }
    if (/whatsapp/i.test(f.key) || /whatsapp/i.test(frage)) {
      const z = istZustimmung(f.wert);
      if (z !== null && !ALLE_KONTAKT.has(f.n)) {
        whatsappHaekchen = whatsappHaekchen === true ? true : z;
        antworten.push({ frage, antwort: f.wert });
        continue;
      }
    }
    if (ALLE_KONTAKT.has(f.n) || (f.titel && ALLE_KONTAKT.has(norm(f.titel)))) continue;
    antworten.push({ frage: frage.slice(0, 300), antwort: f.wert.slice(0, 2000) });
  }
  // UTM auch aus meta/tracking/URL
  for (const quelle of [body.meta, body.tracking, body.query, body.utm]) {
    if (!quelle || typeof quelle !== "object") continue;
    for (const [k, v] of Object.entries(quelle as Record<string, unknown>)) {
      const n = norm(k);
      const w = wert(v);
      if (n.startsWith("utm") && w && !/^utm[\s_]/i.test(w) && !utm[n.replace(/^utm/, "")]) utm[n.replace(/^utm/, "")] = w.slice(0, 200);
    }
  }

  return {
    externalId: typeof body.id === "string" && body.id ? body.id : typeof body.id === "number" ? String(body.id) : null,
    funnelName: wert(body.funnelName) ?? wert(body.funnel_name) ?? wert((body.funnel as Record<string, unknown> | undefined)?.name) ?? null,
    name: name || null,
    vorname: vorname ?? (name && name.includes(" ") ? name.split(/\s+/)[0] : null),
    firma: finde(KONTAKT.firma),
    email: finde(KONTAKT.email)?.toLowerCase() ?? null,
    telefon: finde(KONTAKT.telefon),
    antworten,
    utm,
    whatsappHaekchen,
  };
}

/** Darf der Lead per WhatsApp angeschrieben werden? */
export function hatEinwilligung(l: Pick<FunnelLead, "whatsappHaekchen">, f: Pick<FunnelEinstellung, "einwilligung_ohne_haekchen">): boolean {
  if (l.whatsappHaekchen !== null) return l.whatsappHaekchen;
  return f.einwilligung_ohne_haekchen;
}

/** Deutsche Festnetznummer (keine Mobilvorwahl 015x/016x/017x) → WhatsApp scheitert fast immer */
export function istFestnetz(e164: string | null | undefined): boolean {
  if (!e164) return false;
  if (!e164.startsWith("+49")) return false;
  return !/^\+491[5-7]\d/.test(e164);
}

/** Close-Notiz mit allen Angaben */
export function notizText(l: FunnelLead, funnelName: string, bestehend: boolean): string {
  const zeilen = [`${bestehend ? "Erneute Eintragung" : "Eintragung"} über Funnel „${funnelName}“`];
  const kontakt = [l.name, l.firma, l.email, l.telefon].filter(Boolean);
  if (kontakt.length) zeilen.push(kontakt.join(" · "));
  const utm = Object.entries(l.utm);
  if (utm.length) zeilen.push(utm.map(([k, v]) => `utm_${k}: ${v}`).join(" · "));
  if (l.antworten.length) zeilen.push("", ...l.antworten.map((a) => `${a.frage}: ${a.antwort}`));
  return zeilen.join("\n");
}

// ---------------------------------------------------------------------------
// Zeiten
// ---------------------------------------------------------------------------

function berlin(d: Date): { wochentag: number; stunde: number; minute: number; jahr: number; monat: number; tag: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const wt = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1; // 1 = Mo … 7 = So
  return { wochentag: wt, stunde: Number(p.hour) % 24, minute: Number(p.minute), jahr: Number(p.year), monat: Number(p.month), tag: Number(p.day) };
}

/** Zeitpunkt für Berliner Wanduhrzeit */
function berlinZeitpunkt(jahr: number, monat: number, tag: number, stunde: number): Date {
  const wunsch = Date.UTC(jahr, monat - 1, tag, stunde, 0);
  let t = wunsch;
  for (let i = 0; i < 2; i++) {
    const b = berlin(new Date(t));
    t += wunsch - Date.UTC(b.jahr, b.monat - 1, b.tag, b.stunde, b.minute);
  }
  return new Date(t);
}

/** Liegt d im Sendefenster Mo–Fr 8:00–19:59 (Berlin)? */
export function imSendefenster(d: Date): boolean {
  const b = berlin(d);
  return b.wochentag <= 5 && b.stunde >= SENDEFENSTER.von && b.stunde < SENDEFENSTER.bis;
}

/** d selbst, wenn im Sendefenster – sonst der nächste Werktag 8:00 Uhr */
export function naechstesSendefenster(d: Date): Date {
  if (imSendefenster(d)) return d;
  const b = berlin(d);
  // Heute noch vor 8 Uhr an einem Werktag → heute 8:00, sonst ab morgen den nächsten Werktag suchen
  let plus = b.wochentag <= 5 && b.stunde < SENDEFENSTER.von ? 0 : 1;
  for (; plus < 8; plus++) {
    const kandidat = berlinZeitpunkt(b.jahr, b.monat, b.tag + plus, SENDEFENSTER.von);
    if (berlin(kandidat).wochentag <= 5) return kandidat;
  }
  return d;
}

export function pruefZeit(eingetragen: Date): Date {
  return new Date(eingetragen.getTime() + WARTEZEIT_MIN * MIN);
}

export type Ergebnis = "direkt_gebucht" | "nicht_gebucht" | "spaeter_gebucht";

/** Gebucht innerhalb der Wartezeit = direkt gebucht */
export function ergebnisFuer(eingetragen: Date, gebucht: Date | null): Ergebnis {
  if (!gebucht) return "nicht_gebucht";
  return gebucht.getTime() - eingetragen.getTime() <= WARTEZEIT_MIN * MIN ? "direkt_gebucht" : "spaeter_gebucht";
}

/** Buchung (Calendly/Close-Termin) passt zur Eintragung: gleiche E-Mail oder Nummer, nach der Eintragung (−5 Min. Puffer) */
export function passtBuchung(
  e: { email: string | null; telefon: string | null; eingetragen_am: string },
  b: { email: string | null; telefon: string | null; created_at: string },
): boolean {
  if (new Date(b.created_at).getTime() < new Date(e.eingetragen_am).getTime() - 5 * MIN) return false;
  const mail = e.email?.trim().toLowerCase();
  if (mail && b.email?.trim().toLowerCase() === mail) return true;
  return !!e.telefon && !!b.telefon && e.telefon === b.telefon;
}

/** Buchungslink mit Vorbelegung (Calendly: name, email) und Herkunft */
export function buchungsUrl(basis: string, e: { name: string | null; email: string | null; funnel: string }): string {
  const u = new URL(basis);
  if (e.name && !u.searchParams.has("name")) u.searchParams.set("name", e.name);
  if (e.email && !u.searchParams.has("email")) u.searchParams.set("email", e.email);
  if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "whatsapp");
  if (!u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", e.funnel);
  return u.toString();
}

/** Text der Close-Aufgabe nach 10 Min. ohne Termin */
export function aufgabenText(e: { name: string | null; firma: string | null; telefon: string | null }, funnelName: string): string {
  const wer = [e.name, e.firma && e.firma !== e.name ? `(${e.firma})` : null].filter(Boolean).join(" ") || "Lead";
  return `Jetzt anrufen: ${wer} hat sich über „${funnelName}“ eingetragen, aber keinen Termin gebucht${e.telefon ? ` – ${e.telefon}` : ""}`;
}
