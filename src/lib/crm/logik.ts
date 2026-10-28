/**
 * CRM für den Handwerker (reine Logik, nur Typ-Imports — scripts/test-crm.mjs lädt die Datei direkt).
 *
 * Pipeline in 6 Stufen über dem bestehenden Enum lead_status:
 *   Neu → Kontaktiert → Termin vor Ort → Angebot raus → Auftrag ✅  |  Verloren ❌
 */

import type { LeadStatus, SlaAmpel, VerlustGrund } from "../types/database";

const MIN = 60_000;
const TZ = "Europe/Berlin";

// ---------------------------------------------------------------------------
// Stufen
// ---------------------------------------------------------------------------

export type Stufe = "neu" | "kontaktiert" | "termin" | "angebot" | "auftrag" | "verloren";

export interface StufenInfo {
  id: Stufe;
  label: string;
  /** Kurzname für Tabs auf dem Handy */
  kurz: string;
  /** Status, der beim Verschieben in diese Stufe gesetzt wird */
  zielStatus: LeadStatus;
  /** Alle Status, die in dieser Stufe angezeigt werden */
  status: LeadStatus[];
  /** Tailwind-Klassen für Abzeichen */
  farbe: string;
  /** Abschluss-Stufe (Auftrag/Verloren) */
  abschluss: boolean;
}

export const STUFEN: readonly StufenInfo[] = [
  { id: "neu", label: "Neu", kurz: "Neu", zielStatus: "neu", status: ["neu"], farbe: "bg-blue-100 text-blue-800", abschluss: false },
  { id: "kontaktiert", label: "Kontaktiert", kurz: "Kontakt", zielStatus: "kontaktiert", status: ["kontaktiert"], farbe: "bg-sky-100 text-sky-800", abschluss: false },
  // termin_vereinbart ist ein Alias aus der alten Pipeline → wird unter „Termin vor Ort“ gezeigt
  { id: "termin", label: "Termin vor Ort", kurz: "Termin", zielStatus: "vor_ort_termin", status: ["vor_ort_termin", "termin_vereinbart"], farbe: "bg-violet-100 text-violet-800", abschluss: false },
  { id: "angebot", label: "Angebot raus", kurz: "Angebot", zielStatus: "angebot_raus", status: ["angebot_raus"], farbe: "bg-amber-100 text-amber-800", abschluss: false },
  { id: "auftrag", label: "Auftrag ✅", kurz: "Auftrag", zielStatus: "gewonnen", status: ["gewonnen"], farbe: "bg-emerald-100 text-emerald-800", abschluss: true },
  // kein_interesse / nicht_erreicht (alte Status) zählen als verloren
  { id: "verloren", label: "Verloren ❌", kurz: "Verloren", zielStatus: "verloren", status: ["verloren", "kein_interesse", "nicht_erreicht"], farbe: "bg-red-100 text-red-800", abschluss: true },
];

export const STUFEN_IDS: readonly Stufe[] = STUFEN.map((s) => s.id);

const STUFE_NACH_STATUS = new Map<LeadStatus, Stufe>(
  STUFEN.flatMap((s) => s.status.map((st) => [st, s.id] as const)),
);

export function istStufe(wert: unknown): wert is Stufe {
  return typeof wert === "string" && (STUFEN_IDS as readonly string[]).includes(wert);
}

export function stufeVon(status: LeadStatus): Stufe {
  return STUFE_NACH_STATUS.get(status) ?? "neu";
}

export function stufenInfo(stufe: Stufe): StufenInfo {
  return STUFEN.find((s) => s.id === stufe) ?? STUFEN[0];
}

export function statusFuerStufe(stufe: Stufe): LeadStatus {
  return stufenInfo(stufe).zielStatus;
}

/** Reihenfolge in der Pipeline (Verloren = -1, liegt außerhalb) */
export function stufenRang(stufe: Stufe): number {
  if (stufe === "verloren") return -1;
  return STUFEN_IDS.indexOf(stufe);
}

/** Zusatz-Hinweis bei alten Status (z. B. „Nicht erreicht“ unter Verloren). */
export function statusHinweis(status: LeadStatus): string | null {
  if (status === "nicht_erreicht") return "Nicht erreicht";
  if (status === "kein_interesse") return "Kein Interesse";
  if (status === "termin_vereinbart") return "Termin vereinbart";
  return null;
}

/** Welche Angabe braucht der Wechsel in diese Stufe? */
export function brauchtAngabe(stufe: Stufe): "angebotswert" | "auftragswert" | "verlustgrund" | null {
  if (stufe === "angebot") return "angebotswert";
  if (stufe === "auftrag") return "auftragswert";
  if (stufe === "verloren") return "verlustgrund";
  return null;
}

// ---------------------------------------------------------------------------
// Verlustgründe
// ---------------------------------------------------------------------------

export const VERLUST_GRUENDE: readonly { value: VerlustGrund; label: string }[] = [
  { value: "zu_teuer", label: "Zu teuer" },
  { value: "kein_bedarf_mehr", label: "Kein Bedarf mehr" },
  { value: "anderer_anbieter", label: "Anderer Anbieter" },
  { value: "nicht_erreicht", label: "Nicht erreicht" },
  { value: "unpassende_anfrage", label: "Unpassende Anfrage" },
  { value: "sonstiges", label: "Sonstiges" },
];

export function verlustGrundLabel(grund: VerlustGrund | null | undefined): string | null {
  if (!grund) return null;
  return VERLUST_GRUENDE.find((g) => g.value === grund)?.label ?? grund;
}

export interface StufenWechselEingabe {
  stufe: Stufe;
  angebotswert?: number | null;
  auftragswert?: number | null;
  verlust_grund?: VerlustGrund | null;
  verlust_notiz?: string | null;
}

/** Prüft die Pflichtangaben eines Stufenwechsels. null = in Ordnung, sonst Fehlertext. */
export function pruefeStufenWechsel(e: StufenWechselEingabe): string | null {
  if (e.stufe === "auftrag") {
    if (e.auftragswert == null || !Number.isFinite(e.auftragswert) || e.auftragswert <= 0) {
      return "Bitte den Auftragswert in Euro eintragen.";
    }
  }
  if (e.stufe === "angebot" && e.angebotswert != null) {
    if (!Number.isFinite(e.angebotswert) || e.angebotswert < 0) return "Der Angebotswert stimmt nicht.";
  }
  if (e.stufe === "verloren") {
    if (!e.verlust_grund || !VERLUST_GRUENDE.some((g) => g.value === e.verlust_grund)) {
      return "Bitte einen Grund antippen.";
    }
    if (e.verlust_grund === "sonstiges" && !e.verlust_notiz?.trim()) {
      return "Bitte kurz aufschreiben, warum.";
    }
  }
  return null;
}

/** Euro-Eingabe wie „3.500“, „3500,50“, „3 500 €“ → Zahl (null = leer/ungültig). */
export function leseEuro(text: string | null | undefined): number | null {
  if (text == null) return null;
  let t = String(text).replace(/[€\s]/g, "");
  if (!t) return null;
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Speed-to-Lead-Ampel und Alter
// ---------------------------------------------------------------------------

/** Ampel nur für neue, noch nicht kontaktierte Leads: grün < 15 Min., gelb < 60, sonst rot. */
export function speedAmpel(
  lead: { status: LeadStatus; created_at: string; first_contact_at: string | null },
  jetzt: Date = new Date(),
): SlaAmpel | null {
  if (lead.status !== "neu" || lead.first_contact_at) return null;
  const minuten = (jetzt.getTime() - new Date(lead.created_at).getTime()) / MIN;
  if (minuten < 15) return "gruen";
  if (minuten < 60) return "gelb";
  return "rot";
}

/** „gerade eben“, „vor 12 Min.“, „vor 3 Std.“, „gestern“, „vor 4 Tagen“, „am 03.02.“ */
export function alterText(iso: string, jetzt: Date = new Date()): string {
  const diff = jetzt.getTime() - new Date(iso).getTime();
  const min = Math.floor(diff / MIN);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const std = Math.floor(min / 60);
  if (std < 24) return `vor ${std} Std.`;
  const tage = Math.floor(std / 24);
  if (tage === 1) return "gestern";
  if (tage < 30) return `vor ${tage} Tagen`;
  return `am ${new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso))}`;
}

/** Dauer in Minuten → „8 Min.“, „2 Std. 5 Min.“, „3 Tage“ */
export function dauerText(minuten: number): string {
  const m = Math.max(0, Math.round(minuten));
  if (m < 60) return `${m} Min.`;
  const std = Math.floor(m / 60);
  if (std < 24) {
    const rest = m % 60;
    return rest ? `${std} Std. ${rest} Min.` : `${std} Std.`;
  }
  const tage = Math.round(std / 24);
  return tage === 1 ? "1 Tag" : `${tage} Tage`;
}

// ---------------------------------------------------------------------------
// Telefon, WhatsApp
// ---------------------------------------------------------------------------

/** Deutsche/E.164-Nummer → nur Ziffern mit Ländervorwahl (ohne +), null = unbrauchbar. */
export function telefonE164Ziffern(telefon: string | null | undefined): string | null {
  if (!telefon) return null;
  let t = telefon.trim().replace(/\(0\)/g, "");
  const plus = t.startsWith("+");
  t = t.replace(/\D/g, "");
  if (!t) return null;
  if (plus) {
    // schon international
  } else if (t.startsWith("00")) {
    t = t.slice(2);
  } else if (t.startsWith("0")) {
    t = "49" + t.slice(1);
  } else if (!t.startsWith("49") || t.length < 11) {
    // ohne Vorwahl-Null, z. B. „1512345678“ → deutsche Mobilnummer annehmen
    t = "49" + t;
  }
  if (t.length < 8 || t.length > 15) return null;
  return t;
}

export function telLink(telefon: string | null | undefined): string | null {
  const z = telefonE164Ziffern(telefon);
  return z ? `tel:+${z}` : null;
}

export function waGruss(vorname: string | null | undefined, firmenName: string): string {
  const name = vorname?.trim();
  return `Guten Tag${name ? ` ${name}` : ""}, hier ist ${firmenName}. Vielen Dank für Ihre Anfrage! Wann können wir Sie kurz anrufen?`;
}

/** https://wa.me/<E.164 ohne +>?text=<Gruß> — null, wenn keine brauchbare Nummer. */
export function waLink(
  telefon: string | null | undefined,
  firmenName: string,
  vorname?: string | null,
): string | null {
  const z = telefonE164Ziffern(telefon);
  if (!z) return null;
  return `https://wa.me/${z}?text=${encodeURIComponent(waGruss(vorname, firmenName))}`;
}

// ---------------------------------------------------------------------------
// Berliner Zeit, Rückruf-Schnellwahl
// ---------------------------------------------------------------------------

interface BerlinTeile {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
}

export function berlinTeile(d: Date): BerlinTeile {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, Number(x.value)]),
  );
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute };
}

/** Berliner Wandzeit → Zeitpunkt (Sommer-/Winterzeit korrekt; Tag darf überlaufen, z. B. d = 32). */
export function berlinZeit(y: number, m: number, d: number, h = 0, min = 0): Date {
  const ziel = Date.UTC(y, m - 1, d, h, min);
  let t = ziel;
  for (let i = 0; i < 2; i++) {
    const b = berlinTeile(new Date(t));
    const alsUtc = Date.UTC(b.y, b.m - 1, b.d, b.h, b.min);
    t += ziel - alsUtc;
  }
  return new Date(t);
}

/** Beginn des Berliner Kalendertags (+ offsetTage). */
export function berlinTagesbeginn(jetzt: Date, offsetTage = 0): Date {
  const b = berlinTeile(jetzt);
  return berlinZeit(b.y, b.m, b.d + offsetTage);
}

/** Ende des heutigen Berliner Tages (= Beginn von morgen). */
export function heuteEnde(jetzt: Date = new Date()): Date {
  return berlinTagesbeginn(jetzt, 1);
}

export type RueckrufWahl = "heute_spaeter" | "morgen_9" | "in_2_tagen";

/** Späteste Uhrzeit für „heute später“ (danach wird die Option ausgeblendet). */
export const HEUTE_SPAETER_BIS = 20;

/**
 * Rückruf-Schnellwahl in Berliner Zeit.
 * heute_spaeter: nächste volle Stunde + 2 Std. (null, wenn das nach 20 Uhr wäre)
 * morgen_9: morgen 9:00 · in_2_tagen: übermorgen 9:00
 */
export function rueckrufZeit(wahl: RueckrufWahl, jetzt: Date = new Date()): Date | null {
  const b = berlinTeile(jetzt);
  if (wahl === "heute_spaeter") {
    const h = b.h + 3; // nächste volle Stunde (+1) + 2 Std.
    if (h > HEUTE_SPAETER_BIS) return null;
    return berlinZeit(b.y, b.m, b.d, h, 0);
  }
  if (wahl === "morgen_9") return berlinZeit(b.y, b.m, b.d + 1, 9, 0);
  return berlinZeit(b.y, b.m, b.d + 2, 9, 0);
}

/** <input type="date"> (+ optional „HH:MM“) als Berliner Zeit → ISO; null = ungültig. */
export function rueckrufAusDatum(datum: string, uhrzeit = "09:00"): Date | null {
  const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  const mu = /^(\d{1,2}):(\d{2})$/.exec(uhrzeit);
  if (!md || !mu) return null;
  const [y, m, d] = [Number(md[1]), Number(md[2]), Number(md[3])];
  const [h, min] = [Number(mu[1]), Number(mu[2])];
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59) return null;
  return berlinZeit(y, m, d, h, min);
}

/** „heute 14:00“, „morgen 9:00“, „Mo., 03.11. 9:00“ */
export function rueckrufText(iso: string, jetzt: Date = new Date()): string {
  const t = new Date(iso);
  const uhr = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(t);
  const heute = berlinTagesbeginn(jetzt).getTime();
  const morgen = berlinTagesbeginn(jetzt, 1).getTime();
  const uebermorgen = berlinTagesbeginn(jetzt, 2).getTime();
  const gestern = berlinTagesbeginn(jetzt, -1).getTime();
  const ts = t.getTime();
  if (ts >= heute && ts < morgen) return `heute ${uhr}`;
  if (ts >= morgen && ts < uebermorgen) return `morgen ${uhr}`;
  if (ts >= gestern && ts < heute) return `gestern ${uhr}`;
  const tag = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" }).format(t);
  return `${tag} ${uhr}`;
}

/** Fester Zeitpunkt für den Verlauf: „Di., 28.10., 14:00“ (Berlin). */
export function zeitpunktText(iso: string | Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// „Heute anrufen“
// ---------------------------------------------------------------------------

export interface AnrufLead {
  id: string;
  status: LeadStatus;
  created_at: string;
  first_contact_at: string | null;
  naechste_aktion_am: string | null;
}

export type AnrufGrund = "neu" | "rueckruf" | "ueberfaellig";

/**
 * Wen heute anrufen? Neue Leads ohne Kontakt (älteste zuerst) + fällige Rückrufe
 * (naechste_aktion_am bis Ende heute, nicht abgeschlossen; früheste zuerst).
 */
export function heuteAnrufen<T extends AnrufLead>(
  leads: T[],
  jetzt: Date = new Date(),
): Array<T & { grund: AnrufGrund }> {
  const ende = heuteEnde(jetzt).getTime();
  const neu: Array<T & { grund: AnrufGrund }> = [];
  const rueck: Array<T & { grund: AnrufGrund }> = [];
  for (const l of leads) {
    if (stufenInfo(stufeVon(l.status)).abschluss) continue;
    if (l.status === "neu" && !l.first_contact_at) {
      neu.push({ ...l, grund: "neu" });
    } else if (l.naechste_aktion_am && new Date(l.naechste_aktion_am).getTime() < ende) {
      const ueber = new Date(l.naechste_aktion_am).getTime() < jetzt.getTime() - 15 * MIN;
      rueck.push({ ...l, grund: ueber ? "ueberfaellig" : "rueckruf" });
    }
  }
  neu.sort((a, b) => a.created_at.localeCompare(b.created_at));
  rueck.sort((a, b) => (a.naechste_aktion_am ?? "").localeCompare(b.naechste_aktion_am ?? ""));
  return [...neu, ...rueck];
}

// ---------------------------------------------------------------------------
// Zeiträume und Kennzahlen
// ---------------------------------------------------------------------------

export type Zeitraum = "7" | "30" | "90" | "monat";

export const ZEITRAEUME: readonly { value: Zeitraum; label: string }[] = [
  { value: "7", label: "7 Tage" },
  { value: "30", label: "30 Tage" },
  { value: "90", label: "90 Tage" },
  { value: "monat", label: "Dieser Monat" },
];

export function leseZeitraum(wert: string | string[] | undefined | null): Zeitraum {
  const v = Array.isArray(wert) ? wert[0] : wert;
  return ZEITRAEUME.some((z) => z.value === v) ? (v as Zeitraum) : "30";
}

/** von = Beginn (00:00 Berlin; heute zählt als voller Tag), bis = jetzt. */
export function zeitraumGrenzen(z: Zeitraum, jetzt: Date = new Date()): { von: Date; bis: Date } {
  if (z === "monat") {
    const b = berlinTeile(jetzt);
    return { von: berlinZeit(b.y, b.m, 1), bis: jetzt };
  }
  const tage = Number(z);
  return { von: berlinTagesbeginn(jetzt, -(tage - 1)), bis: jetzt };
}

export interface KennzahlLead {
  status: LeadStatus;
  created_at: string;
  first_contact_at: string | null;
  angebotswert: number | null;
  auftragswert: number | null;
  /** neu_status aller bisherigen Statuswechsel (für „hat schon mal Termin/Angebot gehabt“) */
  verlauf?: Array<LeadStatus | null>;
}

export interface Kennzahlen {
  anfragen: number;
  kontaktiert: number;
  /** 0–100, null = keine Anfragen */
  kontaktiertQuote: number | null;
  termine: number;
  angebote: number;
  angeboteSumme: number;
  auftraege: number;
  umsatz: number;
  /** Aufträge je Anfrage in % (null = keine Anfragen) */
  abschlussquote: number | null;
  /** Ø Minuten bis zum Erstkontakt (null = noch kein Kontakt) */
  reaktionMinuten: number | null;
}

/** Höchste erreichte Stufe (Verloren zählt nicht, Verlauf wird mitberücksichtigt). */
export function erreichterRang(lead: Pick<KennzahlLead, "status" | "verlauf">): number {
  let rang = stufenRang(stufeVon(lead.status));
  for (const s of lead.verlauf ?? []) {
    if (s) rang = Math.max(rang, stufenRang(stufeVon(s)));
  }
  return rang;
}

/**
 * Kennzahlen für die Anfragen eines Zeitraums (Kohorte: Lead im Zeitraum eingegangen).
 * leads sind bereits auf Firma + Zeitraum gefiltert.
 */
export function berechneKennzahlen(leads: KennzahlLead[]): Kennzahlen {
  const rangTermin = stufenRang("termin");
  const rangAngebot = stufenRang("angebot");
  let kontaktiert = 0;
  let termine = 0;
  let angebote = 0;
  let angeboteSumme = 0;
  let auftraege = 0;
  let umsatz = 0;
  let reaktionSumme = 0;
  let reaktionAnzahl = 0;

  for (const l of leads) {
    const stufe = stufeVon(l.status);
    const rang = erreichterRang(l);
    if (l.first_contact_at || stufe !== "neu") kontaktiert++;
    if (rang >= rangTermin) termine++;
    if (rang >= rangAngebot || l.angebotswert != null) {
      angebote++;
      angeboteSumme += Number(l.angebotswert ?? 0);
    }
    if (stufe === "auftrag") {
      auftraege++;
      umsatz += Number(l.auftragswert ?? 0);
    }
    if (l.first_contact_at) {
      const m = (new Date(l.first_contact_at).getTime() - new Date(l.created_at).getTime()) / MIN;
      if (m >= 0) {
        reaktionSumme += m;
        reaktionAnzahl++;
      }
    }
  }

  const anfragen = leads.length;
  const quote = (n: number) => (anfragen > 0 ? Math.round((n / anfragen) * 100) : null);
  return {
    anfragen,
    kontaktiert,
    kontaktiertQuote: quote(kontaktiert),
    termine,
    angebote,
    angeboteSumme,
    auftraege,
    umsatz,
    abschlussquote: quote(auftraege),
    reaktionMinuten: reaktionAnzahl > 0 ? reaktionSumme / reaktionAnzahl : null,
  };
}

// ---------------------------------------------------------------------------
// Namen
// ---------------------------------------------------------------------------

/** „Max Mustermann“ → { vorname: "Max", nachname: "Mustermann" } (ein Feld im Formular). */
export function teileName(name: string): { vorname: string; nachname: string } {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return { vorname: "", nachname: "" };
  if (teile.length === 1) return { vorname: teile[0], nachname: "" };
  return { vorname: teile[0], nachname: teile.slice(1).join(" ") };
}

export function leadName(l: { vorname: string; nachname: string }): string {
  return `${l.vorname ?? ""} ${l.nachname ?? ""}`.trim() || "Ohne Namen";
}
