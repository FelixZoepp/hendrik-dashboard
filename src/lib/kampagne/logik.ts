/**
 * Kampagne & Berichte je Kunde — reine Logik (ohne Imports; scripts/test-kampagne.mjs lädt die Datei direkt).
 *
 * - Zeiträume in Europe/Berlin (7/30/90 Tage oder Kalendermonat)
 * - Meta-Insights (level=campaign, time_increment=1) → Tageszeilen je Kampagne
 * - Zuordnung Kampagne → Firma (zentrales Werbekonto über Kampagnen-ID, eigenes Konto = alle Kampagnen)
 * - Kennzahlen: Kosten je Anfrage, Kosten je Auftrag, ROI („Für 1 € Werbung X € Umsatz“)
 */

export type Plattform = "meta" | "google";
export const PLATTFORMEN: readonly Plattform[] = ["meta", "google"];

const TZ = "Europe/Berlin";
const TAG_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Datum / Zeitraum (Berlin)
// ---------------------------------------------------------------------------

function berlinTeile(d: Date): { y: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d)
    .split("-")
    .map(Number);
  return { y: p[0], m: p[1], d: p[2] };
}

const zwei = (n: number) => String(n).padStart(2, "0");
const datumText = (y: number, m: number, d: number) => `${y}-${zwei(m)}-${zwei(d)}`;

/** YYYY-MM-DD des Zeitpunkts in Berlin. */
export function berlinDatum(d: Date): string {
  const t = berlinTeile(d);
  return datumText(t.y, t.m, t.d);
}

/** 00:00 Uhr Berliner Zeit am Kalendertag (Sommer-/Winterzeit berücksichtigt). */
export function berlinMitternacht(y: number, m: number, d: number): Date {
  const utc = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Offset an diesem Tag bestimmen: Berliner Stunde um 00:00 UTC (1 im Winter, 2 im Sommer)
  const stunde = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(utc)),
  );
  return new Date(utc - stunde * 3600_000);
}

/** Kalendertag (YYYY-MM-DD) um n Tage verschieben (ohne Zeitzonen-Effekte). */
export function plusTage(datum: string, n: number): string {
  const [y, m, d] = datum.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return datumText(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

/** Anzahl Kalendertage von a bis b inklusive (a ≤ b), sonst 0. */
export function tageZwischen(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return tb < ta ? 0 : Math.round((tb - ta) / TAG_MS) + 1;
}

export function tageImMonat(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const MONATSNAMEN = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export function istMonat(wert: string | null | undefined): wert is string {
  if (!wert || !/^\d{4}-\d{2}$/.test(wert)) return false;
  const m = Number(wert.slice(5, 7));
  return m >= 1 && m <= 12;
}

/** „Oktober 2026“ */
export function monatsName(monat: string): string {
  const [y, m] = monat.split("-").map(Number);
  return `${MONATSNAMEN[m - 1]} ${y}`;
}

/** Aktueller Monat in Berlin als YYYY-MM. */
export function aktuellerMonat(now = new Date()): string {
  const t = berlinTeile(now);
  return `${t.y}-${zwei(t.m)}`;
}

/** Monat verschieben: monatPlus("2026-01", -1) = "2025-12". */
export function monatPlus(monat: string, n: number): string {
  const [y, m] = monat.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${x.getUTCFullYear()}-${zwei(x.getUTCMonth() + 1)}`;
}

export type ZeitraumArt = "tage" | "monat";
export const TAGE_OPTIONEN = [7, 30, 90] as const;

export interface Zeitraum {
  art: ZeitraumArt;
  tage: number | null;
  monat: string | null;
  /** Beginn inkl. (Berliner Mitternacht) — für timestamptz (leads.created_at) */
  start: Date;
  /** Ende exkl. — für timestamptz */
  ende: Date;
  /** Erster Kalendertag (YYYY-MM-DD) — für date-Spalten */
  vonDatum: string;
  /** Letzter Kalendertag inkl. */
  bisDatum: string;
  /** „Diesen Monat“, „Oktober 2026“, „Letzte 30 Tage“ */
  label: string;
  /** 01.10.2026 – 31.10.2026 */
  bereich: string;
}

function deDatum(datum: string): string {
  const [y, m, d] = datum.split("-");
  return `${d}.${m}.${y}`;
}

/** Kalendermonat in Berlin: 1. 00:00 bis 1. des Folgemonats 00:00 (exkl.). */
export function monatsZeitraum(monat: string, now = new Date()): Zeitraum {
  const [y, m] = monat.split("-").map(Number);
  const folge = monatPlus(monat, 1);
  const [fy, fm] = folge.split("-").map(Number);
  const vonDatum = datumText(y, m, 1);
  const bisDatum = datumText(y, m, tageImMonat(y, m));
  return {
    art: "monat",
    tage: null,
    monat,
    start: berlinMitternacht(y, m, 1),
    ende: berlinMitternacht(fy, fm, 1),
    vonDatum,
    bisDatum,
    label: monat === aktuellerMonat(now) ? "Diesen Monat" : monatsName(monat),
    bereich: `${deDatum(vonDatum)} – ${deDatum(bisDatum)}`,
  };
}

/** Letzte n Tage inkl. heute (Berlin), Ende = jetzt. */
export function tageZeitraum(tage: number, now = new Date()): Zeitraum {
  const heute = berlinDatum(now);
  const vonDatum = plusTage(heute, -(tage - 1));
  const [y, m, d] = vonDatum.split("-").map(Number);
  return {
    art: "tage",
    tage,
    monat: null,
    start: berlinMitternacht(y, m, d),
    ende: now,
    vonDatum,
    bisDatum: heute,
    label: `Letzte ${tage} Tage`,
    bereich: `${deDatum(vonDatum)} – ${deDatum(heute)}`,
  };
}

/** Zeitraum aus der URL: ?tage=7|30|90 oder ?monat=YYYY-MM, sonst aktueller Monat. */
export function leseZeitraum(
  params: Record<string, string | string[] | undefined>,
  now = new Date(),
): Zeitraum {
  const eins = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const monat = eins(params.monat);
  if (istMonat(monat)) return monatsZeitraum(monat, now);
  const tage = Number(eins(params.tage));
  if ((TAGE_OPTIONEN as readonly number[]).includes(tage)) return tageZeitraum(tage, now);
  return monatsZeitraum(aktuellerMonat(now), now);
}

/** Zeitraum aus zwei Zeitpunkten (für <KampagnenKarte von bis />). */
export function freierZeitraum(von: Date, bis: Date): Zeitraum {
  const vonDatum = berlinDatum(von);
  // bis ist exklusiv → letzter Kalendertag ist der Tag der letzten Millisekunde davor
  const bisDatum = berlinDatum(new Date(Math.max(von.getTime(), bis.getTime() - 1)));
  return {
    art: "tage",
    tage: tageZwischen(vonDatum, bisDatum),
    monat: null,
    start: von,
    ende: bis,
    vonDatum,
    bisDatum,
    label: `${deDatum(vonDatum)} – ${deDatum(bisDatum)}`,
    bereich: `${deDatum(vonDatum)} – ${deDatum(bisDatum)}`,
  };
}

// ---------------------------------------------------------------------------
// Meta-Insights
// ---------------------------------------------------------------------------

export interface MetaAktion {
  action_type: string;
  value: string;
}

export interface MetaKampagnenInsight {
  date_start: string;
  date_stop?: string;
  campaign_id: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaAktion[];
}

/**
 * Meta liefert dieselben Leads unter mehreren action_types (Summe + Unterarten).
 * „lead“ ist die Gesamtzahl; nur wenn sie fehlt, die erste vorhandene Unterart nehmen —
 * nie addieren (sonst doppelt gezählt).
 */
export const LEAD_AKTIONEN = [
  "lead",
  "onsite_conversion.lead_grouped",
  "leadgen_grouped",
  "offsite_conversion.fb_pixel_lead",
  "onsite_web_lead",
] as const;

export function leadsAusAktionen(actions: MetaAktion[] | null | undefined): number {
  if (!actions?.length) return 0;
  for (const typ of LEAD_AKTIONEN) {
    const a = actions.find((x) => x.action_type === typ);
    if (a) {
      const n = Math.round(Number(a.value));
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
  }
  return 0;
}

export interface KostenZeile {
  plattform: Plattform;
  kampagne_id: string;
  kampagne_name: string | null;
  datum: string;
  ausgaben: number;
  impressionen: number;
  klicks: number;
  leads_plattform: number;
}

const zahl = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const ganz = (v: unknown) => Math.round(zahl(v));
const cent = (v: number) => Math.round(v * 100) / 100;

export function leseMetaInsight(i: MetaKampagnenInsight): KostenZeile | null {
  if (!i?.campaign_id || !/^\d{4}-\d{2}-\d{2}$/.test(i.date_start ?? "")) return null;
  return {
    plattform: "meta",
    kampagne_id: String(i.campaign_id),
    kampagne_name: i.campaign_name ?? null,
    datum: i.date_start,
    ausgaben: cent(zahl(i.spend)),
    impressionen: ganz(i.impressions),
    klicks: ganz(i.clicks),
    leads_plattform: leadsAusAktionen(i.actions),
  };
}

/** Mehrere Zeilen derselben Kampagne am selben Tag zusammenfassen (Upsert-Schlüssel eindeutig). */
export function fasseZusammen(zeilen: KostenZeile[]): KostenZeile[] {
  const map = new Map<string, KostenZeile>();
  for (const z of zeilen) {
    const k = `${z.plattform}|${z.kampagne_id}|${z.datum}`;
    const v = map.get(k);
    if (!v) {
      map.set(k, { ...z });
    } else {
      v.ausgaben = cent(v.ausgaben + z.ausgaben);
      v.impressionen += z.impressionen;
      v.klicks += z.klicks;
      v.leads_plattform += z.leads_plattform;
      v.kampagne_name = v.kampagne_name ?? z.kampagne_name;
    }
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Zuordnung Kampagne → Firma
// ---------------------------------------------------------------------------

export interface Zuordnung {
  company_id: string;
  plattform: Plattform;
  kampagne_id: string;
  kampagne_name?: string | null;
  werbekonto_id?: string | null;
  aktiv: boolean;
}

export interface Werbekonto {
  company_id: string;
  plattform: Plattform;
  werbekonto_id: string;
  aktiv: boolean;
}

/** Meta-Kampagnen-IDs sind rein numerisch; Google ebenso. Leerzeichen entfernen. */
export function normalisiereKampagnenId(id: string | null | undefined): string | null {
  const v = String(id ?? "").replace(/\s+/g, "");
  return /^\d{3,30}$/.test(v) ? v : null;
}

/** „123“, „act_123“, „ act_123 “ → „act_123“; sonst null. */
export function normalisiereWerbekonto(id: string | null | undefined): string | null {
  const v = String(id ?? "").trim().replace(/^act_/i, "");
  return /^\d{3,30}$/.test(v) ? `act_${v}` : null;
}

export type ZuordnungsPruefung =
  | { ok: true; vorhanden: boolean }
  | { ok: false; grund: "ungueltige_id" | "andere_firma"; companyId?: string };

/** Darf die Kampagne dieser Firma zugeordnet werden? (eine Kampagne → genau eine Firma) */
export function pruefeZuordnung(
  neu: { plattform: Plattform; kampagne_id: string; company_id: string },
  bestehende: Zuordnung[],
): ZuordnungsPruefung {
  const id = normalisiereKampagnenId(neu.kampagne_id);
  if (!id || !PLATTFORMEN.includes(neu.plattform)) return { ok: false, grund: "ungueltige_id" };
  const treffer = bestehende.find((z) => z.plattform === neu.plattform && z.kampagne_id === id);
  if (!treffer) return { ok: true, vorhanden: false };
  if (treffer.company_id !== neu.company_id) return { ok: false, grund: "andere_firma", companyId: treffer.company_id };
  return { ok: true, vorhanden: true };
}

export interface KontoKampagne {
  id: string;
  name: string;
  status?: string | null;
}

/** Kampagnen des zentralen Kontos, die noch keiner Firma zugeordnet sind (aktive zuerst). */
export function offeneKampagnen(kampagnen: KontoKampagne[], zuordnungen: Zuordnung[]): KontoKampagne[] {
  const vergeben = new Set(zuordnungen.filter((z) => z.plattform === "meta").map((z) => z.kampagne_id));
  const rang = (s?: string | null) => (s === "ACTIVE" ? 0 : s === "PAUSED" ? 1 : 2);
  return kampagnen
    .filter((k) => !vergeben.has(String(k.id)))
    .sort((a, b) => rang(a.status) - rang(b.status) || a.name.localeCompare(b.name, "de"));
}

export interface ZugeordneteKostenZeile extends KostenZeile {
  company_id: string;
}

/**
 * Tageszeilen einer Firma zuordnen.
 * - Zentrales Konto (kontoFirma null): nur Kampagnen mit aktiver Zuordnung.
 * - Eigenes Konto der Firma (kontoFirma = companyId): alle Kampagnen → diese Firma,
 *   außer eine Kampagne ist ausdrücklich (aktiv oder pausiert) einer anderen Firma zugeordnet.
 */
export function ordneZu(
  zeilen: KostenZeile[],
  zuordnungen: Zuordnung[],
  kontoFirma: string | null = null,
): { zugeordnet: ZugeordneteKostenZeile[]; ohneFirma: string[] } {
  const index = new Map(zuordnungen.map((z) => [`${z.plattform}|${z.kampagne_id}`, z]));
  const zugeordnet: ZugeordneteKostenZeile[] = [];
  const ohne = new Set<string>();
  for (const z of zeilen) {
    const treffer = index.get(`${z.plattform}|${z.kampagne_id}`);
    if (treffer) {
      if (treffer.aktiv) zugeordnet.push({ ...z, company_id: treffer.company_id });
      continue;
    }
    if (kontoFirma) zugeordnet.push({ ...z, company_id: kontoFirma });
    else ohne.add(z.kampagne_id);
  }
  return { zugeordnet, ohneFirma: [...ohne] };
}

// ---------------------------------------------------------------------------
// Leads & Kennzahlen
// ---------------------------------------------------------------------------

/** Quellen, die nicht aus der Werbung kommen (zählen nicht für Kosten je Anfrage). */
export const NICHT_WERBE_QUELLEN = ["manuell", "empfehlung"] as const;

/** Status, die heißen: Es gab einen Termin vor Ort (oder der Lead ist schon weiter). */
export const TERMIN_STATUS = ["vor_ort_termin", "angebot_raus", "gewonnen"] as const;

export interface LeadZeile {
  status: string;
  quelle: string | null;
  auftragswert: number | string | null;
  angebotswert?: number | string | null;
  created_at: string;
}

export function istWerbeLead(l: Pick<LeadZeile, "quelle">): boolean {
  return !(NICHT_WERBE_QUELLEN as readonly string[]).includes(l.quelle ?? "");
}

export function hatterTermin(l: LeadZeile): boolean {
  if ((TERMIN_STATUS as readonly string[]).includes(l.status)) return true;
  // verloren nach Angebot → Termin hat stattgefunden
  return l.status === "verloren" && l.angebotswert != null && zahl(l.angebotswert) > 0;
}

export interface LeadZahlen {
  leads: number;
  termine: number;
  auftraege: number;
  umsatz: number;
}

/** Leads aus der eigenen leads-Tabelle zählen (nur Werbe-Leads). */
export function zaehleLeads(leads: LeadZeile[]): LeadZahlen {
  const r: LeadZahlen = { leads: 0, termine: 0, auftraege: 0, umsatz: 0 };
  for (const l of leads) {
    if (!istWerbeLead(l)) continue;
    r.leads++;
    if (hatterTermin(l)) r.termine++;
    if (l.status === "gewonnen") {
      r.auftraege++;
      r.umsatz += zahl(l.auftragswert);
    }
  }
  r.umsatz = cent(r.umsatz);
  return r;
}

export interface ManuelleKosten {
  monat: string; // YYYY-MM-01 (date)
  betrag: number | string;
}

/** Anteil manueller Monatskosten im Zeitraum (tagesgenau anteilig). */
export function manuellerAnteil(k: ManuelleKosten, vonDatum: string, bisDatum: string): number {
  const [y, m] = k.monat.slice(0, 7).split("-").map(Number);
  if (!y || !m) return 0;
  const tage = tageImMonat(y, m);
  const mStart = datumText(y, m, 1);
  const mEnde = datumText(y, m, tage);
  const von = vonDatum > mStart ? vonDatum : mStart;
  const bis = bisDatum < mEnde ? bisDatum : mEnde;
  const ueberlapp = tageZwischen(von, bis);
  return ueberlapp === 0 ? 0 : (zahl(k.betrag) * ueberlapp) / tage;
}

/** Manuelle Monatskosten gleichmäßig auf die Kalendertage des Monats verteilen (nur Tage im Zeitraum). */
export function manuelleTageswerte(
  manuell: ManuelleKosten[],
  vonDatum: string,
  bisDatum: string,
): Array<{ datum: string; ausgaben: number }> {
  const out: Array<{ datum: string; ausgaben: number }> = [];
  for (const k of manuell) {
    const [y, m] = k.monat.slice(0, 7).split("-").map(Number);
    if (!y || !m) continue;
    const tage = tageImMonat(y, m);
    const proTag = zahl(k.betrag) / tage;
    const mStart = datumText(y, m, 1);
    const mEnde = datumText(y, m, tage);
    for (let d = vonDatum > mStart ? vonDatum : mStart; d <= bisDatum && d <= mEnde; d = plusTage(d, 1)) {
      out.push({ datum: d, ausgaben: proTag });
    }
  }
  return out;
}

export function summeAusgaben(
  kosten: Array<{ ausgaben: number | string }>,
  manuell: ManuelleKosten[],
  vonDatum: string,
  bisDatum: string,
): number {
  const plattform = kosten.reduce((s, k) => s + zahl(k.ausgaben), 0);
  const hand = manuell.reduce((s, k) => s + manuellerAnteil(k, vonDatum, bisDatum), 0);
  return cent(plattform + hand);
}

export interface Kennzahlen extends LeadZahlen {
  ausgaben: number;
  /** null = keine Anfragen (Division durch 0) */
  kostenJeLead: number | null;
  /** Umsatz / Budget; null = kein Budget */
  roi: number | null;
  kostenJeAuftrag: number | null;
  /** Anteil Anfragen mit Termin (0–1), null ohne Anfragen */
  terminQuote: number | null;
}

const teile = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a) ? a / b : null);

export function berechneKennzahlen(ausgaben: number, z: LeadZahlen): Kennzahlen {
  const a = Math.max(0, zahl(ausgaben));
  return {
    ...z,
    ausgaben: cent(a),
    kostenJeLead: z.leads > 0 && a > 0 ? teile(a, z.leads) : null,
    roi: teile(z.umsatz, a),
    kostenJeAuftrag: z.auftraege > 0 && a > 0 ? teile(a, z.auftraege) : null,
    terminQuote: teile(z.termine, z.leads),
  };
}

// ---------------------------------------------------------------------------
// Verlauf je Woche (Montag, Berlin)
// ---------------------------------------------------------------------------

/** Montag der Woche (YYYY-MM-DD) zu einem Kalendertag. */
export function wochenMontag(datum: string): string {
  const [y, m, d] = datum.split("-").map(Number);
  const wt = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mo=0
  return plusTage(datum, -wt);
}

export interface WochenPunkt {
  woche: string; // Montag YYYY-MM-DD
  label: string; // „ab 21.10.“
  leads: number;
  ausgaben: number;
}

export function wochenVerlauf(
  leads: Array<Pick<LeadZeile, "created_at" | "quelle">>,
  kosten: Array<{ datum: string; ausgaben: number | string }>,
  vonDatum: string,
  bisDatum: string,
): WochenPunkt[] {
  const punkte = new Map<string, WochenPunkt>();
  for (let w = wochenMontag(vonDatum); w <= bisDatum; w = plusTage(w, 7)) {
    const [, m, d] = w.split("-");
    punkte.set(w, { woche: w, label: `ab ${d}.${m}.`, leads: 0, ausgaben: 0 });
  }
  for (const l of leads) {
    if (!istWerbeLead(l)) continue;
    const tag = berlinDatum(new Date(l.created_at));
    if (tag < vonDatum || tag > bisDatum) continue;
    const p = punkte.get(wochenMontag(tag));
    if (p) p.leads++;
  }
  for (const k of kosten) {
    if (k.datum < vonDatum || k.datum > bisDatum) continue;
    const p = punkte.get(wochenMontag(k.datum));
    if (p) p.ausgaben = cent(p.ausgaben + zahl(k.ausgaben));
  }
  return [...punkte.values()];
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

/** 640 → „640 €“, 27.83 → „28 €“, 7.4 → „7,40 €“ (unter 10 € mit Cent). Leerzeichen ist ein normales. */
export function euro(wert: number, opts: { cent?: boolean } = {}): string {
  const mitCent = opts.cent ?? Math.abs(wert) < 10;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: mitCent ? 2 : 0,
    maximumFractionDigits: mitCent ? 2 : 0,
  })
    .format(wert)
    .replace(/ /g, " ");
}

/** „Für 1 € Werbung 7,40 € Umsatz“ */
export function roiText(roi: number | null): string | null {
  if (roi == null) return null;
  return `Für 1 € Werbung ${euro(roi, { cent: true })} Umsatz`;
}

const anfragen = (n: number) => `${n} ${n === 1 ? "Anfrage" : "Anfragen"}`;

/** „Diesen Monat: 23 Anfragen für 640 € – 28 € pro Anfrage“ */
export function zusammenfassung(label: string, k: Pick<Kennzahlen, "leads" | "ausgaben" | "kostenJeLead">): string {
  if (k.leads === 0 && k.ausgaben === 0) return `${label}: noch keine Anfragen und keine Werbeausgaben`;
  if (k.ausgaben === 0) return `${label}: ${anfragen(k.leads)}`;
  if (k.leads === 0) return `${label}: ${euro(k.ausgaben)} Werbebudget, noch keine Anfragen`;
  return `${label}: ${anfragen(k.leads)} für ${euro(k.ausgaben)} – ${euro(k.kostenJeLead ?? 0)} pro Anfrage`;
}
