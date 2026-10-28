/**
 * Sales-Auswertung für den Handwerker — reine Logik (nur Typ-Imports; scripts/test-auswertung.mjs lädt
 * die Datei direkt mit Node). Alle Wochentage/Uhrzeiten in Europe/Berlin.
 *
 * Datengrundlage (Migration 00018):
 *   lead_anrufe   – jeder Kontaktversuch (Anruf/WhatsApp) mit Zeitpunkt + Ergebnis
 *   lead_termine  – Termine mit Ergebnis, Neuvereinbarung über ersetzt_termin_id
 *   lead_activities (status_wechsel) – Zeitpunkt je Stufe (abgeleitet, keine eigenen Spalten)
 *
 * Kohorte: Gezählt werden Anfragen, die im Zeitraum eingegangen sind — mit allen ihren
 * Anrufen und Terminen (auch wenn die nach dem Zeitraum liegen).
 */

import type { LeadQuelle, LeadStatus, VerlustGrund } from "../types/database";

const MIN = 60_000;
const TAG_MS = 24 * 60 * MIN;
const TZ = "Europe/Berlin";

/** Unter so vielen Versuchen/Terminen ist eine Quote nicht belastbar („zu wenig Daten“). */
export const MIN_STICHPROBE = 5;

// ---------------------------------------------------------------------------
// Grundtypen
// ---------------------------------------------------------------------------

export type AnrufErgebnis = "erreicht" | "nicht_erreicht" | "mailbox" | "falsche_nummer" | "rueckruf_gewuenscht";
export type Kanal = "anruf" | "whatsapp";
export type TerminArt = "vor_ort" | "telefon" | "video";
export type TerminStatus = "geplant" | "stattgefunden" | "nicht_erschienen" | "abgesagt" | "verschoben";

export const ANRUF_ERGEBNISSE: readonly { value: AnrufErgebnis; label: string; erreicht: boolean }[] = [
  { value: "erreicht", label: "Erreicht", erreicht: true },
  { value: "nicht_erreicht", label: "Nicht erreicht", erreicht: false },
  { value: "mailbox", label: "Mailbox", erreicht: false },
  { value: "rueckruf_gewuenscht", label: "Rückruf gewünscht", erreicht: true },
  { value: "falsche_nummer", label: "Falsche Nummer", erreicht: false },
];

export const ANRUF_ERGEBNIS_WERTE = ANRUF_ERGEBNISSE.map((e) => e.value) as [AnrufErgebnis, ...AnrufErgebnis[]];

export const TERMIN_ARTEN: readonly { value: TerminArt; label: string }[] = [
  { value: "vor_ort", label: "Vor Ort" },
  { value: "telefon", label: "Telefon" },
  { value: "video", label: "Video" },
];

export const TERMIN_ART_WERTE = TERMIN_ARTEN.map((a) => a.value) as [TerminArt, ...TerminArt[]];

export const TERMIN_STATUS: readonly { value: TerminStatus; label: string; farbe: string }[] = [
  { value: "geplant", label: "Geplant", farbe: "bg-blue-100 text-blue-800" },
  { value: "stattgefunden", label: "Stattgefunden", farbe: "bg-emerald-100 text-emerald-800" },
  { value: "nicht_erschienen", label: "Nicht erschienen", farbe: "bg-red-100 text-red-800" },
  { value: "abgesagt", label: "Abgesagt", farbe: "bg-zinc-200 text-zinc-800" },
  { value: "verschoben", label: "Verschoben", farbe: "bg-amber-100 text-amber-800" },
];

export const TERMIN_STATUS_WERTE = TERMIN_STATUS.map((s) => s.value) as [TerminStatus, ...TerminStatus[]];

export function istErreicht(ergebnis: AnrufErgebnis | null | undefined): boolean {
  return !!ergebnis && !!ANRUF_ERGEBNISSE.find((e) => e.value === ergebnis)?.erreicht;
}

export function anrufErgebnisLabel(e: AnrufErgebnis | null | undefined): string {
  if (!e) return "Ohne Ergebnis";
  return ANRUF_ERGEBNISSE.find((x) => x.value === e)?.label ?? e;
}

export function terminArtLabel(a: TerminArt | string | null | undefined): string {
  return TERMIN_ARTEN.find((x) => x.value === a)?.label ?? "Termin";
}

export function terminStatusInfo(s: TerminStatus | string) {
  return TERMIN_STATUS.find((x) => x.value === s) ?? TERMIN_STATUS[0];
}

export interface ALead {
  id: string;
  company_id?: string;
  created_at: string;
  status: LeadStatus;
  quelle: LeadQuelle | string;
  /** Kampagnen-Name (leads.campaign) oder -ID (leads.kampagne_id) */
  kampagne: string | null;
  first_contact_at: string | null;
  angebotswert: number | null;
  auftragswert: number | null;
  verlust_grund: VerlustGrund | null;
  /** status_wechsel-Aktivitäten: wann in welchen Status */
  wechsel: Array<{ am: string; neu_status: LeadStatus | null }>;
  name?: string;
  telefon?: string | null;
}

export interface AAnruf {
  id?: string;
  lead_id: string;
  am: string;
  kanal: Kanal;
  ergebnis: AnrufErgebnis | null;
}

export interface ATermin {
  id: string;
  lead_id: string;
  art: TerminArt;
  beginn: string;
  status: TerminStatus;
  ersetzt_termin_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Rechnen: Median, Mittel, Quote (robust gegen leere Mengen / Division durch 0)
// ---------------------------------------------------------------------------

export function median(werte: number[]): number | null {
  const w = werte.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (w.length === 0) return null;
  const m = Math.floor(w.length / 2);
  return w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2;
}

export function mittel(werte: number[]): number | null {
  const w = werte.filter((x) => Number.isFinite(x));
  if (w.length === 0) return null;
  return w.reduce((s, x) => s + x, 0) / w.length;
}

/** Anteil in Prozent (0–100, gerundet). null, wenn die Basis 0 ist. */
export function quote(teil: number, basis: number): number | null {
  if (!basis || basis <= 0 || !Number.isFinite(teil)) return null;
  return Math.round((teil / basis) * 100);
}

/** Ungerundete Quote 0–1 (für Sortierungen/Faktoren). */
function rate(teil: number, basis: number): number | null {
  return basis > 0 ? teil / basis : null;
}

// ---------------------------------------------------------------------------
// Berliner Zeit
// ---------------------------------------------------------------------------

const FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const WOCHENTAG_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export interface BerlinZeitpunkt {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  /** 0 = Montag … 6 = Sonntag */
  tag: number;
}

export function berlin(iso: string | Date): BerlinZeitpunkt {
  const teile: Record<string, string> = {};
  for (const p of FORMAT.formatToParts(new Date(iso))) if (p.type !== "literal") teile[p.type] = p.value;
  return {
    y: Number(teile.year),
    m: Number(teile.month),
    d: Number(teile.day),
    h: Number(teile.hour),
    min: Number(teile.minute),
    tag: WOCHENTAG_INDEX[teile.weekday] ?? 0,
  };
}

/** Berliner Wandzeit → Zeitpunkt (Sommer-/Winterzeit korrekt; Tag darf überlaufen). */
export function berlinZeit(y: number, m: number, d: number, h = 0, min = 0): Date {
  const ziel = Date.UTC(y, m - 1, d, h, min);
  let t = ziel;
  for (let i = 0; i < 2; i++) {
    const b = berlin(new Date(t));
    t += ziel - Date.UTC(b.y, b.m - 1, b.d, b.h, b.min);
  }
  return new Date(t);
}

/** Kalendertage (Berlin) zwischen zwei Zeitpunkten, z. B. Vereinbarung → Termin. */
export function kalenderTage(von: string | Date, bis: string | Date): number {
  const a = berlin(von);
  const b = berlin(bis);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / TAG_MS);
}

export const TAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] as const;
export const TAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
const TAGE_ADVERB = ["montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags", "sonntags"] as const;

/** Stunden der Heatmap: 7–21 Uhr (Zelle 20 = 20–21 Uhr). */
export const HEATMAP_STUNDEN: readonly number[] = Array.from({ length: 14 }, (_, i) => i + 7);

/** Zwei-Stunden-Blöcke für Balken und „Beste Zeiten“ (7–9 … 19–21 Uhr). */
export const STUNDEN_BLOECKE: readonly { von: number; bis: number; label: string }[] = [7, 9, 11, 13, 15, 17, 19].map(
  (v) => ({ von: v, bis: v + 2, label: `${v}–${v + 2} Uhr` }),
);

export function blockVonStunde(h: number): number {
  return STUNDEN_BLOECKE.findIndex((b) => h >= b.von && h < b.bis);
}

// ---------------------------------------------------------------------------
// Zeitraum und Filter
// ---------------------------------------------------------------------------

export type AZeitraum = "7" | "30" | "90" | "monat" | "jahr";

export const A_ZEITRAEUME: readonly { value: AZeitraum; label: string }[] = [
  { value: "7", label: "7 Tage" },
  { value: "30", label: "30 Tage" },
  { value: "90", label: "90 Tage" },
  { value: "monat", label: "Dieser Monat" },
  { value: "jahr", label: "Dieses Jahr" },
];

export function leseAZeitraum(wert: string | string[] | undefined | null): AZeitraum {
  const v = Array.isArray(wert) ? wert[0] : wert;
  return A_ZEITRAEUME.some((z) => z.value === v) ? (v as AZeitraum) : "30";
}

/** von = 00:00 Berlin (heute zählt als voller Tag), bis = jetzt. */
export function aZeitraumGrenzen(z: AZeitraum, jetzt: Date = new Date()): { von: Date; bis: Date } {
  const b = berlin(jetzt);
  if (z === "monat") return { von: berlinZeit(b.y, b.m, 1), bis: jetzt };
  if (z === "jahr") return { von: berlinZeit(b.y, 1, 1), bis: jetzt };
  return { von: berlinZeit(b.y, b.m, b.d - (Number(z) - 1)), bis: jetzt };
}

export const OHNE_KAMPAGNE = "__ohne__";

export function filterLeads<T extends Pick<ALead, "quelle" | "kampagne">>(
  leads: T[],
  f: { quelle?: string | null; kampagne?: string | null },
): T[] {
  return leads.filter((l) => {
    if (f.quelle && f.quelle !== "alle" && l.quelle !== f.quelle) return false;
    if (f.kampagne && f.kampagne !== "alle") {
      if (f.kampagne === OHNE_KAMPAGNE ? !!l.kampagne : l.kampagne !== f.kampagne) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Stufen (eigene Kopie der Rangfolge aus crm/logik, damit diese Datei importfrei bleibt)
// ---------------------------------------------------------------------------

const RANG: Record<string, number> = {
  neu: 0,
  kontaktiert: 1,
  termin_vereinbart: 2,
  vor_ort_termin: 2,
  angebot_raus: 3,
  gewonnen: 4,
  verloren: -1,
  kein_interesse: -1,
  nicht_erreicht: -1,
};

export function statusRang(s: LeadStatus | string | null | undefined): number {
  return s ? RANG[s] ?? 0 : 0;
}

function istAbgeschlossen(s: LeadStatus): boolean {
  return s === "gewonnen" || statusRang(s) === -1;
}

/** Erster Zeitpunkt, zu dem der Lead mindestens Rang r erreicht hat (aus status_wechsel). */
function ersterWechselAb(lead: ALead, r: number): string | null {
  let best: string | null = null;
  for (const w of lead.wechsel) {
    if (statusRang(w.neu_status) >= r && (!best || w.am < best)) best = w.am;
  }
  return best;
}

function minuten(von: string, bis: string): number {
  return Math.max(0, (new Date(bis).getTime() - new Date(von).getTime()) / MIN);
}

// ---------------------------------------------------------------------------
// Je Lead: erster Versuch, erstes Erreichen, Versuch-Nummern
// ---------------------------------------------------------------------------

export interface LeadKontakt {
  ersterVersuch: string | null;
  erstesErreichen: string | null;
  /** Anrufversuch-Nummer (1 = erster Anruf), bei der der Lead erreicht wurde; null = (noch) nicht */
  versuchBisErreichen: number | null;
  anrufVersuche: number;
}

function nachZeit<T extends { am: string }>(a: T, b: T) {
  return a.am.localeCompare(b.am);
}

/** anrufe = alle Kontaktversuche DIESES Leads. */
export function leadKontakt(lead: ALead, anrufe: AAnruf[]): LeadKontakt {
  const sortiert = [...anrufe].sort(nachZeit);
  const nurAnrufe = sortiert.filter((a) => a.kanal === "anruf");
  let ersterVersuch: string | null = sortiert.length > 0 ? sortiert[0].am : null;
  // Altdaten: Erstkontakt ohne protokollierten Versuch
  if (lead.first_contact_at && (!ersterVersuch || lead.first_contact_at < ersterVersuch) && sortiert.length === 0) {
    ersterVersuch = lead.first_contact_at;
  }
  const idx = nurAnrufe.findIndex((a) => istErreicht(a.ergebnis));
  let erstesErreichen = idx >= 0 ? nurAnrufe[idx].am : null;
  if (!erstesErreichen && sortiert.length === 0) {
    // Altdaten ohne Versuche: „Kontaktiert“ oder weiter gilt als erreicht
    erstesErreichen = ersterWechselAb(lead, 1);
    if (!ersterVersuch) ersterVersuch = erstesErreichen;
  }
  return {
    ersterVersuch,
    erstesErreichen,
    versuchBisErreichen: idx >= 0 ? idx + 1 : null,
    anrufVersuche: nurAnrufe.length,
  };
}

function gruppiere<T extends { lead_id: string }>(liste: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of liste) {
    const arr = m.get(x.lead_id);
    if (arr) arr.push(x);
    else m.set(x.lead_id, [x]);
  }
  return m;
}

// ---------------------------------------------------------------------------
// 1. Speed-to-Lead
// ---------------------------------------------------------------------------

export type SpeedBucket = "u5" | "5_15" | "15_60" | "1_4" | "4_24" | "ueber24" | "nie";

export const SPEED_BUCKETS: readonly { id: SpeedBucket; label: string; bis: number }[] = [
  { id: "u5", label: "unter 5 Min.", bis: 5 },
  { id: "5_15", label: "5–15 Min.", bis: 15 },
  { id: "15_60", label: "15–60 Min.", bis: 60 },
  { id: "1_4", label: "1–4 Std.", bis: 240 },
  { id: "4_24", label: "4–24 Std.", bis: 1440 },
  { id: "ueber24", label: "über 24 Std.", bis: Infinity },
  { id: "nie", label: "noch nie", bis: NaN },
];

export function speedBucket(min: number | null | undefined): SpeedBucket {
  if (min == null || !Number.isFinite(min)) return "nie";
  const b = SPEED_BUCKETS.find((x) => min < x.bis);
  return b?.id ?? "ueber24";
}

/** Tageszeit des Eingangs (für „Abends/Wochenende langsamer?“). */
export const EINGANG_BLOECKE: readonly { id: string; label: string; test: (h: number) => boolean }[] = [
  { id: "morgen", label: "Morgens (7–12 Uhr)", test: (h) => h >= 7 && h < 12 },
  { id: "mittag", label: "Mittags (12–17 Uhr)", test: (h) => h >= 12 && h < 17 },
  { id: "abend", label: "Abends (17–22 Uhr)", test: (h) => h >= 17 && h < 22 },
  { id: "nacht", label: "Nachts (22–7 Uhr)", test: (h) => h >= 22 || h < 7 },
];

export interface Verteilung {
  anzahl: number;
  mittel: number | null;
  median: number | null;
}

function verteilung(werte: number[]): Verteilung {
  return { anzahl: werte.length, mittel: mittel(werte), median: median(werte) };
}

export interface SpeedErgebnis {
  leads: number;
  ersterVersuch: Verteilung;
  erstesErreichen: Verteilung;
  buckets: Array<{ id: SpeedBucket; label: string; anzahl: number; anteil: number | null; auftraege: number; abschlussquote: number | null }>;
  innerhalb5: number | null;
  innerhalb15: number | null;
  nieKontaktiert: number;
  /** Abschlussquote (unter 5 Min.) ÷ Abschlussquote (5 Min. und später). null = zu wenig Daten */
  faktorSchnell: number | null;
  quoteSchnell: number | null;
  quoteLangsam: number | null;
  nachWochentag: Array<{ tag: number; label: string } & Verteilung>;
  nachTageszeit: Array<{ id: string; label: string } & Verteilung>;
  werktag: Verteilung;
  wochenende: Verteilung;
  langsamste: Array<{ leadId: string; name: string; eingang: string; minuten: number; nie: boolean; status: LeadStatus }>;
}

export function berechneSpeed(leads: ALead[], anrufe: AAnruf[], jetzt: Date = new Date()): SpeedErgebnis {
  const proLead = gruppiere(anrufe);
  const bucketZ = new Map<SpeedBucket, { anzahl: number; auftraege: number }>(SPEED_BUCKETS.map((b) => [b.id, { anzahl: 0, auftraege: 0 }]));
  const versuchMin: number[] = [];
  const erreichMin: number[] = [];
  const tagWerte: number[][] = TAGE.map(() => []);
  const blockWerte: number[][] = EINGANG_BLOECKE.map(() => []);
  const werktag: number[] = [];
  const wochenende: number[] = [];
  const kandidaten: SpeedErgebnis["langsamste"] = [];
  let u5 = 0;
  let u15 = 0;
  const schnell = { n: 0, a: 0 };
  const langsam = { n: 0, a: 0 };

  for (const l of leads) {
    const k = leadKontakt(l, proLead.get(l.id) ?? []);
    const vMin = k.ersterVersuch ? minuten(l.created_at, k.ersterVersuch) : null;
    const eMin = k.erstesErreichen ? minuten(l.created_at, k.erstesErreichen) : null;
    const gewonnen = l.status === "gewonnen";
    const b = speedBucket(vMin);
    const z = bucketZ.get(b)!;
    z.anzahl++;
    if (gewonnen) z.auftraege++;

    if (vMin != null) {
      versuchMin.push(vMin);
      if (vMin < 5) u5++;
      if (vMin < 15) u15++;
      if (vMin < 5) {
        schnell.n++;
        if (gewonnen) schnell.a++;
      } else {
        langsam.n++;
        if (gewonnen) langsam.a++;
      }
      const e = berlin(l.created_at);
      tagWerte[e.tag].push(vMin);
      const bi = EINGANG_BLOECKE.findIndex((x) => x.test(e.h));
      if (bi >= 0) blockWerte[bi].push(vMin);
      (e.tag >= 5 ? wochenende : werktag).push(vMin);
    }
    if (eMin != null) erreichMin.push(eMin);

    kandidaten.push({
      leadId: l.id,
      name: l.name ?? "",
      eingang: l.created_at,
      minuten: vMin ?? minuten(l.created_at, jetzt.toISOString()),
      nie: vMin == null,
      status: l.status,
    });
  }

  const n = leads.length;
  const qS = rate(schnell.a, schnell.n);
  const qL = rate(langsam.a, langsam.n);
  const faktor =
    schnell.n >= 3 && langsam.n >= 3 && qS != null && qL != null && qL > 0 ? Math.round((qS / qL) * 10) / 10 : null;

  // Langsamste: noch nie angerufene, offene Leads zuerst (warten am längsten), dann längste Reaktionszeit
  const langsamste = kandidaten
    .filter((k) => !k.nie || !istAbgeschlossen(k.status))
    .sort((a, b) => (a.nie !== b.nie ? (a.nie ? -1 : 1) : b.minuten - a.minuten))
    .slice(0, 10);

  return {
    leads: n,
    ersterVersuch: verteilung(versuchMin),
    erstesErreichen: verteilung(erreichMin),
    buckets: SPEED_BUCKETS.map((b) => {
      const z = bucketZ.get(b.id)!;
      return { id: b.id, label: b.label, anzahl: z.anzahl, anteil: quote(z.anzahl, n), auftraege: z.auftraege, abschlussquote: quote(z.auftraege, z.anzahl) };
    }),
    innerhalb5: quote(u5, n),
    innerhalb15: quote(u15, n),
    nieKontaktiert: bucketZ.get("nie")!.anzahl,
    faktorSchnell: faktor,
    quoteSchnell: quote(schnell.a, schnell.n),
    quoteLangsam: quote(langsam.a, langsam.n),
    nachWochentag: TAGE.map((label, tag) => ({ tag, label, ...verteilung(tagWerte[tag]) })),
    nachTageszeit: EINGANG_BLOECKE.map((b, i) => ({ id: b.id, label: b.label, ...verteilung(blockWerte[i]) })),
    werktag: verteilung(werktag),
    wochenende: verteilung(wochenende),
    langsamste,
  };
}

// ---------------------------------------------------------------------------
// 2. Erreichbarkeit
// ---------------------------------------------------------------------------

export interface QuotenZelle {
  versuche: number;
  erreicht: number;
  /** 0–100; null = keine Versuche */
  quote: number | null;
  /** genug Versuche für eine belastbare Aussage */
  genug: boolean;
}

function zelle(versuche: number, erreicht: number): QuotenZelle {
  return { versuche, erreicht, quote: quote(erreicht, versuche), genug: versuche >= MIN_STICHPROBE };
}

export interface ErreichbarkeitErgebnis {
  gesamt: QuotenZelle & {
    nichtErreicht: number;
    mailbox: number;
    falscheNummer: number;
    rueckrufGewuenscht: number;
    mailboxAnteil: number | null;
    falscheNummerAnteil: number | null;
    ohneErgebnis: number;
    whatsapp: number;
    ausserhalb: number;
  };
  /** [tag][index in HEATMAP_STUNDEN] */
  heatmap: QuotenZelle[][];
  proTag: Array<QuotenZelle & { tag: number; label: string }>;
  proBlock: Array<QuotenZelle & { block: number; label: string }>;
  beste: Array<QuotenZelle & { tag: number; block: number; text: string }>;
  schlechteste: Array<QuotenZelle & { tag: number; block: number; text: string }>;
  versucheBisErreichen: {
    erreichteLeads: number;
    nieErreicht: number;
    mittel: number | null;
    verteilung: Array<{ label: string; anzahl: number; anteil: number | null }>;
  };
  quoteNachVersuch: Array<QuotenZelle & { label: string }>;
}

export function slotText(tag: number, block: number): string {
  return `${TAGE_ADVERB[tag]} ${STUNDEN_BLOECKE[block]?.label ?? ""}`.trim();
}

/** Heatmap-Zelle eines Zeitpunkts: { tag, stundenIndex } oder null (außerhalb 7–21 Uhr). */
export function heatmapZelle(iso: string): { tag: number; stunde: number; index: number } | null {
  const b = berlin(iso);
  const index = HEATMAP_STUNDEN.indexOf(b.h);
  return index >= 0 ? { tag: b.tag, stunde: b.h, index } : null;
}

export function berechneErreichbarkeit(anrufe: AAnruf[]): ErreichbarkeitErgebnis {
  const heat = TAGE.map(() => HEATMAP_STUNDEN.map(() => ({ v: 0, e: 0 })));
  const tagZ = TAGE.map(() => ({ v: 0, e: 0 }));
  const blockZ = STUNDEN_BLOECKE.map(() => ({ v: 0, e: 0 }));
  const slotZ = TAGE.map(() => STUNDEN_BLOECKE.map(() => ({ v: 0, e: 0 })));
  const g = { v: 0, e: 0, nicht: 0, mailbox: 0, falsch: 0, rueck: 0, ohne: 0, wa: 0, aussen: 0 };

  for (const a of anrufe) {
    if (a.kanal !== "anruf") {
      g.wa++;
      continue;
    }
    if (!a.ergebnis) {
      g.ohne++;
      continue;
    }
    const ok = istErreicht(a.ergebnis);
    g.v++;
    if (ok) g.e++;
    if (a.ergebnis === "nicht_erreicht") g.nicht++;
    if (a.ergebnis === "mailbox") g.mailbox++;
    if (a.ergebnis === "falsche_nummer") g.falsch++;
    if (a.ergebnis === "rueckruf_gewuenscht") g.rueck++;

    const b = berlin(a.am);
    tagZ[b.tag].v++;
    if (ok) tagZ[b.tag].e++;
    const hi = HEATMAP_STUNDEN.indexOf(b.h);
    if (hi >= 0) {
      heat[b.tag][hi].v++;
      if (ok) heat[b.tag][hi].e++;
    } else {
      g.aussen++;
    }
    const bi = blockVonStunde(b.h);
    if (bi >= 0) {
      blockZ[bi].v++;
      slotZ[b.tag][bi].v++;
      if (ok) {
        blockZ[bi].e++;
        slotZ[b.tag][bi].e++;
      }
    }
  }

  const slots = slotZ.flatMap((reihe, tag) =>
    reihe.map((s, block) => ({ ...zelle(s.v, s.e), tag, block, text: slotText(tag, block) })),
  );
  const belastbar = slots.filter((s) => s.genug && s.quote != null);
  // Beste = über dem Durchschnitt, Schlechteste = darunter (bei wenigen Slots nicht dieselben)
  const schnitt = g.v > 0 ? (g.e / g.v) * 100 : 0;
  const beste = [...belastbar]
    .filter((s) => belastbar.length === 1 || s.quote! >= schnitt)
    .sort((a, b) => b.quote! - a.quote! || b.versuche - a.versuche)
    .slice(0, 3);
  const besteKeys = new Set(beste.map((s) => `${s.tag}-${s.block}`));
  const schlechteste = [...belastbar]
    .filter((s) => !besteKeys.has(`${s.tag}-${s.block}`) && s.quote! < schnitt)
    .sort((a, b) => a.quote! - b.quote! || b.versuche - a.versuche)
    .slice(0, 3);

  // Versuche bis Erreichen + Quote nach Versuch Nr. (nur Anrufe, bis einschließlich erstem Erreichen)
  const proLead = gruppiere(anrufe.filter((a) => a.kanal === "anruf"));
  const bisErreichen: number[] = [];
  let nieErreicht = 0;
  const nachNr = [0, 1, 2, 3].map(() => ({ v: 0, e: 0 }));
  for (const liste of proLead.values()) {
    const s = [...liste].sort(nachZeit);
    let erreichtBei: number | null = null;
    for (let i = 0; i < s.length; i++) {
      const nr = Math.min(i, 3);
      const ok = istErreicht(s[i].ergebnis);
      if (s[i].ergebnis) {
        nachNr[nr].v++;
        if (ok) nachNr[nr].e++;
      }
      if (ok) {
        erreichtBei = i + 1;
        break;
      }
    }
    if (erreichtBei != null) bisErreichen.push(erreichtBei);
    else nieErreicht++;
  }
  const verteilungNr = ["1. Versuch", "2. Versuch", "3. Versuch", "4. und später"].map((label, i) => {
    const anzahl = bisErreichen.filter((n) => (i < 3 ? n === i + 1 : n >= 4)).length;
    return { label, anzahl, anteil: quote(anzahl, bisErreichen.length) };
  });

  return {
    gesamt: {
      ...zelle(g.v, g.e),
      nichtErreicht: g.nicht,
      mailbox: g.mailbox,
      falscheNummer: g.falsch,
      rueckrufGewuenscht: g.rueck,
      mailboxAnteil: quote(g.mailbox, g.v),
      falscheNummerAnteil: quote(g.falsch, g.v),
      ohneErgebnis: g.ohne,
      whatsapp: g.wa,
      ausserhalb: g.aussen,
    },
    heatmap: heat.map((reihe) => reihe.map((c) => zelle(c.v, c.e))),
    proTag: tagZ.map((z, tag) => ({ ...zelle(z.v, z.e), tag, label: TAGE[tag] })),
    proBlock: blockZ.map((z, block) => ({ ...zelle(z.v, z.e), block, label: STUNDEN_BLOECKE[block].label })),
    beste,
    schlechteste,
    versucheBisErreichen: {
      erreichteLeads: bisErreichen.length,
      nieErreicht,
      mittel: mittel(bisErreichen),
      verteilung: verteilungNr,
    },
    quoteNachVersuch: ["1. Versuch", "2. Versuch", "3. Versuch", "4. und später"].map((label, i) => ({
      ...zelle(nachNr[i].v, nachNr[i].e),
      label,
    })),
  };
}

// ---------------------------------------------------------------------------
// 3. Termine, No-Shows, Recovery
// ---------------------------------------------------------------------------

export const VORLAUF_BUCKETS: readonly { label: string; test: (t: number) => boolean }[] = [
  { label: "am selben Tag", test: (t) => t <= 0 },
  { label: "1 Tag vorher", test: (t) => t === 1 },
  { label: "2–3 Tage vorher", test: (t) => t >= 2 && t <= 3 },
  { label: "4–7 Tage vorher", test: (t) => t >= 4 && t <= 7 },
  { label: "mehr als 7 Tage", test: (t) => t > 7 },
];

export const TERMIN_BLOECKE: readonly { label: string; test: (h: number) => boolean }[] = [
  { label: "vor 10 Uhr", test: (h) => h < 10 },
  { label: "10–13 Uhr", test: (h) => h >= 10 && h < 13 },
  { label: "13–16 Uhr", test: (h) => h >= 13 && h < 16 },
  { label: "16–19 Uhr", test: (h) => h >= 16 && h < 19 },
  { label: "ab 19 Uhr", test: (h) => h >= 19 },
];

export interface ShowZelle {
  label: string;
  entschieden: number;
  noShows: number;
  noShowQuote: number | null;
  genug: boolean;
}

function showZelle(label: string, entschieden: number, noShows: number): ShowZelle {
  return { label, entschieden, noShows, noShowQuote: quote(noShows, entschieden), genug: entschieden >= MIN_STICHPROBE };
}

/** Alle Nachfolger eines Termins (über ersetzt_termin_id, auch über mehrere Stufen). */
export function nachfolger(terminId: string, termine: ATermin[]): ATermin[] {
  const kinder = new Map<string, ATermin[]>();
  for (const t of termine) {
    if (!t.ersetzt_termin_id) continue;
    const arr = kinder.get(t.ersetzt_termin_id);
    if (arr) arr.push(t);
    else kinder.set(t.ersetzt_termin_id, [t]);
  }
  const ergebnis: ATermin[] = [];
  const gesehen = new Set<string>([terminId]);
  const offen = [terminId];
  while (offen.length) {
    const id = offen.pop()!;
    for (const k of kinder.get(id) ?? []) {
      if (gesehen.has(k.id)) continue;
      gesehen.add(k.id);
      ergebnis.push(k);
      offen.push(k.id);
    }
  }
  return ergebnis;
}

/**
 * Welcher alte Termin wird durch einen neuen Termin ersetzt? Der jüngste Termin dieses Leads mit
 * „nicht erschienen“ oder „verschoben“, der noch keinen Nachfolger hat (sonst null).
 */
export function zuErsetzenderTermin(termineDesLeads: ATermin[]): ATermin | null {
  const ersetzt = new Set(termineDesLeads.map((t) => t.ersetzt_termin_id).filter(Boolean));
  const kandidaten = termineDesLeads
    .filter((t) => (t.status === "nicht_erschienen" || t.status === "verschoben") && !ersetzt.has(t.id))
    .sort((a, b) => b.beginn.localeCompare(a.beginn));
  return kandidaten[0] ?? null;
}

/** Termin ist vorbei, aber noch ohne Ergebnis → „Wie war der Termin?“ */
export function wartetAufRueckmeldung(t: Pick<ATermin, "status" | "beginn">, jetzt: Date = new Date()): boolean {
  return t.status === "geplant" && new Date(t.beginn).getTime() <= jetzt.getTime();
}

export interface TermineErgebnis {
  gesamt: number;
  zaehler: Record<TerminStatus, number>;
  /** geplant und Beginn in der Zukunft */
  anstehend: number;
  /** geplant, Beginn vorbei, noch kein Ergebnis */
  ohneRueckmeldung: number;
  entschieden: number;
  showRate: number | null;
  noShowRate: number | null;
  nachWochentag: ShowZelle[];
  nachUhrzeit: ShowZelle[];
  nachVorlauf: ShowZelle[];
  recovery: {
    noShows: number;
    mitNeuemTermin: number;
    neuerTerminQuote: number | null;
    stattgefunden: number;
    stattgefundenQuote: number | null;
    auftrag: number;
    auftragQuote: number | null;
  };
  offeneNoShows: Array<{ terminId: string; leadId: string; beginn: string }>;
  wartend: Array<{ terminId: string; leadId: string; beginn: string }>;
  /** Leads mit mindestens einem Termin */
  leadsMitTermin: number;
}

export function berechneTermine(termine: ATermin[], leads: ALead[], jetzt: Date = new Date()): TermineErgebnis {
  const leadStatus = new Map(leads.map((l) => [l.id, l.status]));
  const eigene = termine.filter((t) => leadStatus.has(t.lead_id));
  const zaehler = Object.fromEntries(TERMIN_STATUS_WERTE.map((s) => [s, 0])) as Record<TerminStatus, number>;
  let anstehend = 0;
  let ohneRueckmeldung = 0;
  const tagZ = TAGE.map(() => ({ e: 0, n: 0 }));
  const uhrZ = TERMIN_BLOECKE.map(() => ({ e: 0, n: 0 }));
  const vorZ = VORLAUF_BUCKETS.map(() => ({ e: 0, n: 0 }));
  const wartend: TermineErgebnis["wartend"] = [];

  for (const t of eigene) {
    zaehler[t.status] = (zaehler[t.status] ?? 0) + 1;
    if (t.status === "geplant") {
      if (wartetAufRueckmeldung(t, jetzt)) {
        ohneRueckmeldung++;
        wartend.push({ terminId: t.id, leadId: t.lead_id, beginn: t.beginn });
      } else anstehend++;
    }
    if (t.status !== "stattgefunden" && t.status !== "nicht_erschienen") continue;
    const no = t.status === "nicht_erschienen" ? 1 : 0;
    const b = berlin(t.beginn);
    tagZ[b.tag].e++;
    tagZ[b.tag].n += no;
    const ui = TERMIN_BLOECKE.findIndex((x) => x.test(b.h));
    if (ui >= 0) {
      uhrZ[ui].e++;
      uhrZ[ui].n += no;
    }
    const vi = VORLAUF_BUCKETS.findIndex((x) => x.test(kalenderTage(t.created_at, t.beginn)));
    if (vi >= 0) {
      vorZ[vi].e++;
      vorZ[vi].n += no;
    }
  }

  const entschieden = zaehler.stattgefunden + zaehler.nicht_erschienen;

  // Recovery
  const noShowTermine = eigene.filter((t) => t.status === "nicht_erschienen");
  let mitNeu = 0;
  let statt = 0;
  let auftrag = 0;
  const offeneNoShows: TermineErgebnis["offeneNoShows"] = [];
  const proLead = gruppiere(eigene);
  for (const t of noShowTermine) {
    const folge = nachfolger(t.id, eigene);
    if (folge.length > 0) {
      mitNeu++;
      if (folge.some((f) => f.status === "stattgefunden")) statt++;
      if (leadStatus.get(t.lead_id) === "gewonnen") auftrag++;
      continue;
    }
    const status = leadStatus.get(t.lead_id);
    // Schon ein späterer Termin für denselben Lead (ohne Verknüpfung) → nicht mehr offen
    const spaeter = (proLead.get(t.lead_id) ?? []).some((x) => x.id !== t.id && x.created_at > t.created_at && x.beginn > t.beginn);
    if (status && !istAbgeschlossen(status) && !spaeter) {
      offeneNoShows.push({ terminId: t.id, leadId: t.lead_id, beginn: t.beginn });
    }
  }
  offeneNoShows.sort((a, b) => b.beginn.localeCompare(a.beginn));
  wartend.sort((a, b) => a.beginn.localeCompare(b.beginn));

  return {
    gesamt: eigene.length,
    zaehler,
    anstehend,
    ohneRueckmeldung,
    entschieden,
    showRate: quote(zaehler.stattgefunden, entschieden),
    noShowRate: quote(zaehler.nicht_erschienen, entschieden),
    nachWochentag: tagZ.map((z, i) => showZelle(TAGE[i], z.e, z.n)),
    nachUhrzeit: uhrZ.map((z, i) => showZelle(TERMIN_BLOECKE[i].label, z.e, z.n)),
    nachVorlauf: vorZ.map((z, i) => showZelle(VORLAUF_BUCKETS[i].label, z.e, z.n)),
    recovery: {
      noShows: noShowTermine.length,
      mitNeuemTermin: mitNeu,
      neuerTerminQuote: quote(mitNeu, noShowTermine.length),
      stattgefunden: statt,
      stattgefundenQuote: quote(statt, mitNeu),
      auftrag,
      auftragQuote: quote(auftrag, mitNeu),
    },
    offeneNoShows,
    wartend,
    leadsMitTermin: new Set(eigene.map((t) => t.lead_id)).size,
  };
}

// ---------------------------------------------------------------------------
// 4. Trichter von A bis Z
// ---------------------------------------------------------------------------

export type TrichterStufe = "anfragen" | "kontaktiert" | "erreicht" | "termin" | "stattgefunden" | "angebot" | "auftrag";

export const TRICHTER_STUFEN: readonly { id: TrichterStufe; label: string }[] = [
  { id: "anfragen", label: "Anfragen" },
  { id: "kontaktiert", label: "Kontaktiert" },
  { id: "erreicht", label: "Erreicht" },
  { id: "termin", label: "Termin" },
  { id: "stattgefunden", label: "Termin stattgefunden" },
  { id: "angebot", label: "Angebot" },
  { id: "auftrag", label: "Auftrag" },
];

export interface LeadReise {
  /** je Trichterstufe: erreicht? */
  flags: boolean[];
  /** je Trichterstufe: erster Zeitpunkt (null = unbekannt) */
  zeiten: Array<string | null>;
  kontakt: LeadKontakt;
}

/** Wie weit kam ein Lead? Spätere Stufe ⇒ frühere zählt mit (Trichter bleibt monoton). */
export function leadReise(lead: ALead, anrufe: AAnruf[], termine: ATermin[]): LeadReise {
  const kontakt = leadKontakt(lead, anrufe);
  const rang = Math.max(statusRang(lead.status), ...lead.wechsel.map((w) => statusRang(w.neu_status)));
  const ersterTermin = termine.map((t) => t.created_at).sort()[0] ?? null;
  const statt = termine.filter((t) => t.status === "stattgefunden").map((t) => t.beginn).sort()[0] ?? null;

  const zeiten: Array<string | null> = [
    lead.created_at,
    kontakt.ersterVersuch,
    kontakt.erstesErreichen,
    ersterTermin ?? ersterWechselAb(lead, 2),
    statt,
    ersterWechselAb(lead, 3),
    lead.status === "gewonnen" ? ersterWechselAb(lead, 4) : null,
  ];
  const flags = [
    true,
    !!kontakt.ersterVersuch || rang >= 1,
    !!kontakt.erstesErreichen || rang >= 1,
    termine.length > 0 || rang >= 2,
    !!statt,
    rang >= 3 || lead.angebotswert != null,
    lead.status === "gewonnen",
  ];
  for (let i = flags.length - 2; i >= 0; i--) flags[i] = flags[i] || flags[i + 1];
  return { flags, zeiten, kontakt };
}

export interface TrichterErgebnis {
  stufen: Array<{
    id: TrichterStufe;
    label: string;
    anzahl: number;
    quoteVorschritt: number | null;
    quoteStart: number | null;
    /** Ø / Median Minuten vom vorigen Schritt bis hierher */
    dauerMittel: number | null;
    dauerMedian: number | null;
  }>;
  umsatz: number;
  auftraege: number;
  auftragswertMittel: number | null;
  angebote: number;
  angeboteSumme: number;
  angebotsAbschlussquote: number | null;
  abschlussquote: number | null;
  verloren: number;
  verlustGruende: Array<{ grund: string; anzahl: number; anteil: number | null }>;
}

const VERLUST_LABEL: Record<string, string> = {
  zu_teuer: "Zu teuer",
  kein_bedarf_mehr: "Kein Bedarf mehr",
  anderer_anbieter: "Anderer Anbieter",
  nicht_erreicht: "Nicht erreicht",
  unpassende_anfrage: "Unpassende Anfrage",
  sonstiges: "Sonstiges",
  unbekannt: "Ohne Grund",
};

export function berechneTrichter(leads: ALead[], anrufe: AAnruf[], termine: ATermin[]): TrichterErgebnis {
  const aProLead = gruppiere(anrufe);
  const tProLead = gruppiere(termine);
  const anzahl = TRICHTER_STUFEN.map(() => 0);
  const dauern: number[][] = TRICHTER_STUFEN.map(() => []);
  let umsatz = 0;
  let auftraege = 0;
  let angeboteSumme = 0;
  let verloren = 0;
  const gruende = new Map<string, number>();

  for (const l of leads) {
    const r = leadReise(l, aProLead.get(l.id) ?? [], tProLead.get(l.id) ?? []);
    r.flags.forEach((f, i) => {
      if (f) anzahl[i]++;
    });
    for (let i = 1; i < r.zeiten.length; i++) {
      const a = r.zeiten[i - 1];
      const b = r.zeiten[i];
      if (r.flags[i] && a && b && b >= a) dauern[i].push(minuten(a, b));
    }
    if (l.status === "gewonnen") {
      auftraege++;
      umsatz += Number(l.auftragswert ?? 0);
    }
    if (r.flags[5]) angeboteSumme += Number(l.angebotswert ?? 0);
    if (statusRang(l.status) === -1) {
      verloren++;
      const g =
        l.verlust_grund ??
        (l.status === "nicht_erreicht" ? "nicht_erreicht" : l.status === "kein_interesse" ? "kein_bedarf_mehr" : "unbekannt");
      gruende.set(g, (gruende.get(g) ?? 0) + 1);
    }
  }

  const start = anzahl[0];
  return {
    stufen: TRICHTER_STUFEN.map((s, i) => ({
      id: s.id,
      label: s.label,
      anzahl: anzahl[i],
      quoteVorschritt: i === 0 ? null : quote(anzahl[i], anzahl[i - 1]),
      quoteStart: quote(anzahl[i], start),
      dauerMittel: i === 0 ? null : mittel(dauern[i]),
      dauerMedian: i === 0 ? null : median(dauern[i]),
    })),
    umsatz,
    auftraege,
    auftragswertMittel: auftraege > 0 ? umsatz / auftraege : null,
    angebote: anzahl[5],
    angeboteSumme,
    angebotsAbschlussquote: quote(anzahl[6], anzahl[5]),
    abschlussquote: quote(auftraege, start),
    verloren,
    verlustGruende: [...gruende.entries()]
      .map(([grund, n]) => ({ grund: VERLUST_LABEL[grund] ?? grund, anzahl: n, anteil: quote(n, verloren) }))
      .sort((a, b) => b.anzahl - a.anzahl),
  };
}

// ---------------------------------------------------------------------------
// Vergleich je Gruppe (Quelle, Kampagne, Kunde)
// ---------------------------------------------------------------------------

export interface VergleichZeile {
  schluessel: string;
  anfragen: number;
  kontaktiertQuote: number | null;
  /** Leads erreicht ÷ Anfragen */
  erreichtQuote: number | null;
  /** erreichte Anrufe ÷ Anrufe mit Ergebnis */
  anrufQuote: number | null;
  anrufe: number;
  speedMedian: number | null;
  termine: number;
  showRate: number | null;
  auftraege: number;
  abschlussquote: number | null;
  umsatz: number;
}

export function vergleich(
  leads: ALead[],
  anrufe: AAnruf[],
  termine: ATermin[],
  schluessel: (l: ALead) => string,
): VergleichZeile[] {
  const gruppen = new Map<string, ALead[]>();
  for (const l of leads) {
    const k = schluessel(l);
    const arr = gruppen.get(k);
    if (arr) arr.push(l);
    else gruppen.set(k, [l]);
  }
  const aProLead = gruppiere(anrufe);
  const tProLead = gruppiere(termine);
  const zeilen: VergleichZeile[] = [];
  for (const [k, ls] of gruppen) {
    let kontaktiert = 0;
    let erreicht = 0;
    let termineN = 0;
    let statt = 0;
    let noShow = 0;
    let auftraege = 0;
    let umsatz = 0;
    let anrufeMit = 0;
    let anrufeErreicht = 0;
    const speed: number[] = [];
    for (const l of ls) {
      const a = aProLead.get(l.id) ?? [];
      const t = tProLead.get(l.id) ?? [];
      const r = leadReise(l, a, t);
      if (r.flags[1]) kontaktiert++;
      if (r.flags[2]) erreicht++;
      if (r.flags[3]) termineN++;
      if (r.kontakt.ersterVersuch) speed.push(minuten(l.created_at, r.kontakt.ersterVersuch));
      for (const x of t) {
        if (x.status === "stattgefunden") statt++;
        if (x.status === "nicht_erschienen") noShow++;
      }
      for (const x of a) {
        if (x.kanal === "anruf" && x.ergebnis) {
          anrufeMit++;
          if (istErreicht(x.ergebnis)) anrufeErreicht++;
        }
      }
      if (l.status === "gewonnen") {
        auftraege++;
        umsatz += Number(l.auftragswert ?? 0);
      }
    }
    zeilen.push({
      schluessel: k,
      anfragen: ls.length,
      kontaktiertQuote: quote(kontaktiert, ls.length),
      erreichtQuote: quote(erreicht, ls.length),
      anrufQuote: quote(anrufeErreicht, anrufeMit),
      anrufe: anrufeMit,
      speedMedian: median(speed),
      termine: termineN,
      showRate: quote(statt, statt + noShow),
      auftraege,
      abschlussquote: quote(auftraege, ls.length),
      umsatz,
    });
  }
  return zeilen.sort((a, b) => b.anfragen - a.anfragen || a.schluessel.localeCompare(b.schluessel));
}

// ---------------------------------------------------------------------------
// Ampel (Team-Vergleich je Kunde)
// ---------------------------------------------------------------------------

export type Ampel = "gruen" | "gelb" | "rot" | "grau";

export function ampelSpeed(medianMin: number | null): Ampel {
  if (medianMin == null) return "grau";
  if (medianMin < 15) return "gruen";
  if (medianMin < 60) return "gelb";
  return "rot";
}

/** Höher = besser. null → grau. */
export function ampelQuote(wert: number | null, gruenAb: number, gelbAb: number): Ampel {
  if (wert == null) return "grau";
  if (wert >= gruenAb) return "gruen";
  if (wert >= gelbAb) return "gelb";
  return "rot";
}

export const AMPEL_GRENZEN = {
  erreichtQuote: { gruen: 70, gelb: 50 },
  showRate: { gruen: 80, gelb: 65 },
  abschlussquote: { gruen: 15, gelb: 8 },
} as const;

// ---------------------------------------------------------------------------
// Gesamt + Klartext-Tipps
// ---------------------------------------------------------------------------

export interface Auswertung {
  speed: SpeedErgebnis;
  erreichbarkeit: ErreichbarkeitErgebnis;
  termine: TermineErgebnis;
  trichter: TrichterErgebnis;
  quellen: VergleichZeile[];
  kampagnen: VergleichZeile[];
  tipps: Tipp[];
}

export function berechneAuswertung(e: { leads: ALead[]; anrufe: AAnruf[]; termine: ATermin[]; jetzt?: Date }): Auswertung {
  const jetzt = e.jetzt ?? new Date();
  const ids = new Set(e.leads.map((l) => l.id));
  const anrufe = e.anrufe.filter((a) => ids.has(a.lead_id));
  const termine = e.termine.filter((t) => ids.has(t.lead_id));
  const speed = berechneSpeed(e.leads, anrufe, jetzt);
  const erreichbarkeit = berechneErreichbarkeit(anrufe);
  const termineErg = berechneTermine(termine, e.leads, jetzt);
  const trichter = berechneTrichter(e.leads, anrufe, termine);
  const teil = { speed, erreichbarkeit, termine: termineErg, trichter };
  return {
    ...teil,
    quellen: vergleich(e.leads, anrufe, termine, (l) => String(l.quelle ?? "unbekannt")),
    kampagnen: vergleich(e.leads, anrufe, termine, (l) => l.kampagne ?? OHNE_KAMPAGNE),
    tipps: tipps(teil),
  };
}

export type TippArt = "warnung" | "gut" | "info";

export interface Tipp {
  id: string;
  art: TippArt;
  text: string;
  /** Anker auf der Seite (z. B. „#no-shows“) */
  ziel?: string;
}

/** Dauer in Minuten → „8 Min.“, „2 Std.“, „2 Std. 5 Min.“, „3 Tage“ */
export function dauerKurz(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} Min.`;
  const std = Math.floor(m / 60);
  if (std < 24) {
    const rest = m % 60;
    return rest && std < 4 ? `${std} Std. ${rest} Min.` : `${std} Std.`;
  }
  const tage = Math.round(std / 24);
  return tage === 1 ? "1 Tag" : `${tage} Tage`;
}

function faktorText(f: number): string {
  return `${f.toLocaleString("de-DE", { maximumFractionDigits: 1 })}-mal`;
}

/** Regelbasierte Tipps (keine KI), wichtigste zuerst, höchstens 6. */
export function tipps(a: Pick<Auswertung, "speed" | "erreichbarkeit" | "termine" | "trichter">): Tipp[] {
  const t: Array<Tipp & { prio: number }> = [];
  const s = a.speed;
  const e = a.erreichbarkeit;
  const tm = a.termine;

  // Termine ohne Rückmeldung / offene No-Shows → sofort handeln
  if (tm.offeneNoShows.length > 0) {
    const n = tm.offeneNoShows.length;
    t.push({
      id: "noshow_offen",
      art: "warnung",
      prio: 100,
      ziel: "#no-shows",
      text: `${n} ${n === 1 ? "No-Show wartet" : "No-Shows warten"} auf einen Rückruf – jetzt neuen Termin machen.`,
    });
  }
  if (tm.ohneRueckmeldung > 0) {
    const n = tm.ohneRueckmeldung;
    t.push({
      id: "termin_rueckmeldung",
      art: "info",
      prio: 90,
      ziel: "#termine",
      text: `${n} ${n === 1 ? "Termin ist" : "Termine sind"} vorbei – trag kurz ein, ob ${n === 1 ? "er" : "sie"} stattgefunden ${n === 1 ? "hat" : "haben"}.`,
    });
  }

  // Speed-to-Lead
  const med = s.ersterVersuch.median;
  if (med != null && s.ersterVersuch.anzahl >= 3) {
    if (med >= 15 && s.faktorSchnell != null && s.faktorSchnell >= 1.3) {
      t.push({
        id: "speed_faktor",
        art: "warnung",
        prio: 80,
        ziel: "#speed",
        text: `Du rufst im Schnitt nach ${dauerKurz(med)} an – Anfragen, die du in unter 5 Minuten anrufst, werden ${faktorText(s.faktorSchnell)} so oft zum Auftrag.`,
      });
    } else if (med >= 15) {
      t.push({
        id: "speed_langsam",
        art: "warnung",
        prio: 75,
        ziel: "#speed",
        text: `Du rufst im Schnitt nach ${dauerKurz(med)} an. Ziel: unter 5 Minuten – wer zuerst anruft, bekommt meist den Auftrag.`,
      });
    } else if (med < 5) {
      t.push({
        id: "speed_gut",
        art: "gut",
        prio: 30,
        ziel: "#speed",
        text: `Stark: Du rufst im Schnitt nach ${dauerKurz(med)} an. Weiter so!`,
      });
    } else if (s.faktorSchnell != null && s.faktorSchnell >= 1.3) {
      t.push({
        id: "speed_faktor",
        art: "info",
        prio: 50,
        ziel: "#speed",
        text: `Anfragen, die du in unter 5 Minuten anrufst, werden ${faktorText(s.faktorSchnell)} so oft zum Auftrag.`,
      });
    }
  }
  if (s.nieKontaktiert > 0 && s.leads > 0) {
    const n = s.nieKontaktiert;
    t.push({
      id: "nie_angerufen",
      art: "warnung",
      prio: 85,
      ziel: "#speed",
      text: `${n} ${n === 1 ? "Anfrage wurde" : "Anfragen wurden"} noch nie angerufen.`,
    });
  }
  const wt = s.werktag.median;
  const we = s.wochenende.median;
  if (wt != null && we != null && s.wochenende.anzahl >= 3 && s.werktag.anzahl >= 3 && we > wt * 2 && we - wt >= 30) {
    t.push({
      id: "speed_wochenende",
      art: "info",
      prio: 45,
      ziel: "#speed",
      text: `Am Wochenende dauert es im Schnitt ${dauerKurz(we)} bis zum ersten Anruf (unter der Woche ${dauerKurz(wt)}).`,
    });
  }
  const abend = s.nachTageszeit.find((x) => x.id === "abend");
  const morgen = s.nachTageszeit.find((x) => x.id === "morgen");
  if (abend?.median != null && morgen?.median != null && abend.anzahl >= 3 && morgen.anzahl >= 3 && abend.median > morgen.median * 2 && abend.median - morgen.median >= 30) {
    t.push({
      id: "speed_abend",
      art: "info",
      prio: 44,
      ziel: "#speed",
      text: `Anfragen am Abend rufst du erst nach ${dauerKurz(abend.median)} an – morgens nach ${dauerKurz(morgen.median)}.`,
    });
  }

  // Erreichbarkeit
  const beste = e.beste[0];
  if (beste) {
    t.push({
      id: "beste_zeit",
      art: "gut",
      prio: 70,
      ziel: "#erreichbarkeit",
      text: `Am besten erreichst du Leads ${beste.text} (${beste.quote} % erreicht).`,
    });
  }
  const schlecht = e.schlechteste[0];
  if (schlecht && schlecht.quote != null && e.gesamt.quote != null && (schlecht.quote <= 25 || schlecht.quote <= e.gesamt.quote / 2)) {
    const text = schlecht.quote <= 15 ? "erreichst du fast niemanden" : "erreichst du nur wenige";
    t.push({
      id: "schlechteste_zeit",
      art: "warnung",
      prio: 60,
      ziel: "#erreichbarkeit",
      text: `${slotText(schlecht.tag, schlecht.block).replace(/^./, (c) => c.toUpperCase())} ${text} (${schlecht.quote} %).`,
    });
  }
  const spaet = e.versucheBisErreichen;
  if (spaet.erreichteLeads >= 5) {
    const abZwei = spaet.erreichteLeads - spaet.verteilung[0].anzahl;
    const anteil = quote(abZwei, spaet.erreichteLeads);
    if (anteil != null && anteil >= 20) {
      t.push({
        id: "dranbleiben",
        art: "info",
        prio: 40,
        ziel: "#erreichbarkeit",
        text: `Dranbleiben lohnt sich: ${anteil} % deiner erreichten Leads hast du erst ab dem 2. Versuch erreicht.`,
      });
    }
  }
  if (e.gesamt.genug && (e.gesamt.falscheNummerAnteil ?? 0) >= 10) {
    t.push({
      id: "falsche_nummer",
      art: "info",
      prio: 35,
      ziel: "#erreichbarkeit",
      text: `${e.gesamt.falscheNummerAnteil} % der Anrufe gingen an eine falsche Nummer – hier lieber per WhatsApp oder E-Mail nachfassen.`,
    });
  }

  // Termine
  if (tm.entschieden >= MIN_STICHPROBE && (tm.noShowRate ?? 0) >= 20) {
    t.push({
      id: "noshow_quote",
      art: "warnung",
      prio: 65,
      ziel: "#termine",
      text: `${tm.noShowRate} % deiner Termine platzen. Tipp: Am Vortag kurz anrufen oder per WhatsApp erinnern.`,
    });
  }
  const lang = tm.nachVorlauf[4];
  const kurz = tm.nachVorlauf.slice(0, 3).reduce((x, z) => ({ e: x.e + z.entschieden, n: x.n + z.noShows }), { e: 0, n: 0 });
  const kurzQuote = quote(kurz.n, kurz.e);
  if (lang.genug && kurz.e >= MIN_STICHPROBE && lang.noShowQuote != null && kurzQuote != null && lang.noShowQuote >= kurzQuote + 15) {
    t.push({
      id: "vorlauf",
      art: "info",
      prio: 42,
      ziel: "#termine",
      text: `Termine mit mehr als 7 Tagen Vorlauf platzen öfter (${lang.noShowQuote} % statt ${kurzQuote} %) – lieber zeitnah vereinbaren.`,
    });
  }
  if (tm.recovery.noShows >= 3 && tm.recovery.neuerTerminQuote != null && tm.recovery.neuerTerminQuote < 50) {
    t.push({
      id: "recovery",
      art: "info",
      prio: 55,
      ziel: "#no-shows",
      text: `Nur bei ${tm.recovery.neuerTerminQuote} % der No-Shows gab es einen neuen Termin. Ein Anruf am selben Tag holt viele zurück.`,
    });
  }

  return t
    .sort((x, y) => y.prio - x.prio)
    .slice(0, 6)
    .map((x) => ({ id: x.id, art: x.art, text: x.text, ziel: x.ziel }));
}

// ---------------------------------------------------------------------------
// Erfassung: offenen Anrufversuch finden (Ergebnis nachtragen statt neue Zeile)
// ---------------------------------------------------------------------------

/** Wie lange nach „Anrufen“ wird ein Ergebnis noch diesem Versuch zugeordnet. */
export const OFFENER_VERSUCH_MIN = 180;

/** Jüngster Anrufversuch ohne Ergebnis aus den letzten 3 Std. (sonst null → neuer Versuch). */
export function offenerVersuch<T extends { am: string; kanal: Kanal; ergebnis: AnrufErgebnis | null }>(
  anrufe: T[],
  jetzt: Date = new Date(),
): T | null {
  const grenze = jetzt.getTime() - OFFENER_VERSUCH_MIN * MIN;
  const kandidaten = anrufe
    .filter((a) => a.kanal === "anruf" && !a.ergebnis && new Date(a.am).getTime() >= grenze && new Date(a.am).getTime() <= jetzt.getTime() + MIN)
    .sort((a, b) => b.am.localeCompare(a.am));
  return kandidaten[0] ?? null;
}

/** Termin-Schnellwahl (Berlin): Tag-Offset ab heute + Uhrzeit „HH:MM“. */
export function terminZeit(tagOffset: number, uhrzeit: string, jetzt: Date = new Date()): Date | null {
  const mu = /^(\d{1,2}):(\d{2})$/.exec(uhrzeit);
  if (!mu) return null;
  const h = Number(mu[1]);
  const min = Number(mu[2]);
  if (h > 23 || min > 59) return null;
  const b = berlin(jetzt);
  return berlinZeit(b.y, b.m, b.d + tagOffset, h, min);
}
