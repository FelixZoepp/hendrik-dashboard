/**
 * Gesprächsanalyse — reine Funktionen ohne I/O (nur zod als Import).
 * Phase vorab bestimmen, Wichtigkeit/Upload-Reihenfolge, Fireflies-Tagesbudget, Analyse-Schema
 * und Auswertungen (Einwand-Ranking, Abbruch-Verteilung, Opener-Vergleich).
 * Wird von scripts/test-gespraeche.mjs direkt mit node geprüft.
 */

import { z } from "zod";

export type Phase = "opening" | "setting" | "closing" | "sonstiges";
export type Status = "neu" | "hochgeladen" | "transkribiert" | "analysiert" | "uebersprungen" | "fehler";
export type Rolle = "opener" | "hendrik" | "sonst";

export const PHASEN: Phase[] = ["opening", "setting", "closing", "sonstiges"];
export const PHASE_LABEL: Record<Phase, string> = {
  opening: "Opening",
  setting: "Setting",
  closing: "Closing",
  sonstiges: "Sonstiges",
};

/** Kürzere Calls landen nicht in der Tabelle (Mailbox, sofort aufgelegt) */
export const MIN_DAUER_SEK = 15;
/** Opening-Calls erst ab dieser Dauer hochladen (Env FIREFLIES_OPENING_MIN_SEK) */
export const OPENING_MIN_SEK = 60;
/** Ältere Calls werden nicht mehr hochgeladen (Budget reicht für die aktuellen) */
export const UPLOAD_MAX_TAGE = 3;
/** Fireflies-Aufrufe pro Tag (Env FIREFLIES_TAGESLIMIT) */
export const TAGESLIMIT = 50;
/** Termin zählt zum Call, wenn er höchstens so weit entfernt liegt */
export const TERMIN_FENSTER_MS = 90 * 60_000;
/** Unter dieser Dauer reicht das günstige Modell */
export const KURZ_BIS_SEK = 120;

const TAG_MS = 24 * 60 * 60_000;

/** Positive Ganzzahl aus einer Env-Variable, sonst Standard */
export function zahlAusEnv(wert: string | undefined, standard: number): number {
  const n = Number(wert);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : standard;
}

/** Berliner Kalendertag „2026-10-14“ */
export function berlinTag(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// ---------------------------------------------------------------------------
// Sync: welche Close-Calls werden gespeichert
// ---------------------------------------------------------------------------

export interface CloseCall {
  id: string;
  lead_id: string | null;
  user_id: string | null;
  direction: string | null;
  disposition: string | null;
  duration: number | null;
  has_recording?: boolean | null;
  recording_url: string | null;
  date_created: string;
}

/** Angenommen, mit Aufnahme, mindestens 15 s — ein- wie ausgehend */
export function istAuswertbar(c: CloseCall): boolean {
  return (
    c.disposition === "answered" &&
    !!c.recording_url &&
    c.has_recording !== false &&
    (c.direction === "outbound" || c.direction === "inbound") &&
    (c.duration ?? 0) >= MIN_DAUER_SEK
  );
}

// ---------------------------------------------------------------------------
// Phase vorab (die KI darf korrigieren)
// ---------------------------------------------------------------------------

export interface PhasenKontext {
  rolle: Rolle;
  zeit: Date;
  /** Setting-/Closing-Termine des Leads (wa_termine + Calendly) */
  termine: Array<{ art: "setting" | "closing"; start: Date }>;
  /** Setting-/Closing-Protokolle am Lead (Close Custom Activities) */
  protokolle: Array<{ art: "setting" | "closing"; datum: Date }>;
}

/**
 * Opener → Opening. Hendrik: nächstgelegener Setting-/Closing-Termin (±90 Min.),
 * sonst ein Setting-/Closing-Protokoll am selben Berliner Tag (zeitlich nächstes). Sonst „sonstiges“.
 */
export function vorlaeufigePhase(k: PhasenKontext): { phase: Phase; grund: string } {
  if (k.rolle === "opener") return { phase: "opening", grund: "Anruf eines Openers" };
  if (k.rolle !== "hendrik") return { phase: "sonstiges", grund: "weder Opener noch Hendrik" };
  const t = k.zeit.getTime();
  const termin = k.termine
    .map((x) => ({ ...x, abstand: Math.abs(x.start.getTime() - t) }))
    .filter((x) => x.abstand <= TERMIN_FENSTER_MS)
    .sort((a, b) => a.abstand - b.abstand)[0];
  if (termin) return { phase: termin.art, grund: `${PHASE_LABEL[termin.art]}-Termin zur Anrufzeit` };
  const tag = berlinTag(k.zeit);
  const protokoll = k.protokolle
    .filter((p) => berlinTag(p.datum) === tag)
    .map((p) => ({ ...p, abstand: Math.abs(p.datum.getTime() - t) }))
    .sort((a, b) => a.abstand - b.abstand)[0];
  if (protokoll) return { phase: protokoll.art, grund: `${PHASE_LABEL[protokoll.art]}-Protokoll am selben Tag` };
  return { phase: "sonstiges", grund: "kein Termin/Protokoll gefunden" };
}

// ---------------------------------------------------------------------------
// Wichtigkeit und Upload-Reihenfolge (Fireflies-Budget reicht nur für ~25 Calls/Tag)
// ---------------------------------------------------------------------------

/** Wichtig = Setting, Closing, Opening ab Mindestdauer. Sonst Grund fürs Überspringen. */
export function istWichtig(
  g: { phase: Phase; dauer_sek: number | null },
  openingMinSek = OPENING_MIN_SEK,
): { wichtig: true } | { wichtig: false; grund: string } {
  if (g.phase === "setting" || g.phase === "closing") return { wichtig: true };
  if (g.phase === "opening") {
    return (g.dauer_sek ?? 0) >= openingMinSek ? { wichtig: true } : { wichtig: false, grund: `unwichtig: Opening < ${openingMinSek} s` };
  }
  return { wichtig: false, grund: "unwichtig: kein Opening/Setting/Closing" };
}

const RANG: Record<Phase, number> = { closing: 0, setting: 1, opening: 2, sonstiges: 3 };

/** Sortierschlüssel: Closing vor Setting vor Opening; Opening die längsten zuerst, sonst die ältesten zuerst */
export function uploadPrioritaet(a: { phase: Phase; dauer_sek: number | null; datum: string }, b: typeof a): number {
  if (RANG[a.phase] !== RANG[b.phase]) return RANG[a.phase] - RANG[b.phase];
  if (a.phase === "opening" && (a.dauer_sek ?? 0) !== (b.dauer_sek ?? 0)) return (b.dauer_sek ?? 0) - (a.dauer_sek ?? 0);
  return a.datum.localeCompare(b.datum);
}

/** Älter als UPLOAD_MAX_TAGE → nicht mehr hochladen */
export function zuAltFuerUpload(datum: string, jetzt: Date, maxTage = UPLOAD_MAX_TAGE): boolean {
  return jetzt.getTime() - new Date(datum).getTime() > maxTage * TAG_MS;
}

// ---------------------------------------------------------------------------
// Fireflies-Tagesbudget
// ---------------------------------------------------------------------------

/**
 * Wie viele neue Uploads heute noch gehen: Jeder Upload braucht später einen Transkript-Abruf,
 * offene Uploads ebenso; ein Aufruf bleibt für die Suche nach fehlenden Transkripten reserviert.
 */
export function freieUploads(rest: number, offeneAbrufe: number): number {
  return Math.max(0, Math.floor((rest - offeneAbrufe - 1) / 2));
}

/** 429 oder Rate-Limit-Meldung von Fireflies → für heute aufhören */
export function istRateLimit(status: number, meldung: string | null | undefined): boolean {
  if (status === 429) return true;
  return /rate.?limit|too many requests|too_many_requests|quota|limit exceeded/i.test(meldung ?? "");
}

// ---------------------------------------------------------------------------
// Transkript
// ---------------------------------------------------------------------------

export interface Satz {
  speaker_name: string | null;
  text: string;
  start_time: number;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** „[0:12 | 12s] Sprecher: Text“ — Zeitmarken für Zitate/Sekunden der KI */
export function transkriptText(saetze: Satz[], maxZeichen = 120_000): string {
  let text = saetze.map((s) => `[${mmss(s.start_time)} | ${Math.floor(s.start_time)}s] ${s.speaker_name ?? "?"}: ${s.text}`).join("\n");
  if (text.length > maxZeichen) text = `${text.slice(0, maxZeichen)}\n[… gekürzt]`;
  return text;
}

// ---------------------------------------------------------------------------
// Analyse-Schema (Structured Output) + Validierung
// ---------------------------------------------------------------------------

const ganz = z.number().transform((n) => Math.max(0, Math.round(n)));

export const AnalyseSchema = z.object({
  phase: z.enum(["opening", "setting", "closing", "sonstiges"]),
  zusammenfassung: z.string(),
  ergebnis: z.string(),
  entscheider_erreicht: z.boolean(),
  termin_vereinbart: z.boolean(),
  einwaende: z.array(
    z.object({
      kategorie: z.string(),
      zitat: z.string(),
      sekunde: ganz,
      reaktion: z.string(),
      reaktion_gut: z.boolean(),
    }),
  ),
  opening: z
    .object({
      abbruch_sekunde: ganz.nullable(),
      abbruch_grund: z.string().nullable(),
      hook_funktioniert: z.boolean(),
      gatekeeper: z.boolean(),
    })
    .nullable(),
  fehler: z
    .array(z.object({ fehler: z.string(), zitat: z.string(), sekunde: ganz, besser: z.string() }))
    .transform((xs) => xs.slice(0, 5)),
  staerken: z.array(z.string()),
  punkte: z.number().transform((n) => Math.max(0, Math.min(100, Math.round(n)))),
  tipp: z.string(),
});
export type Analyse = z.infer<typeof AnalyseSchema>;

const s = (description: string) => ({ type: "string", description });
const nullbar = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** JSON-Schema für output_config.format (alle Objekte additionalProperties: false, keine min/max) */
export const ANALYSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "phase", "zusammenfassung", "ergebnis", "entscheider_erreicht", "termin_vereinbart",
    "einwaende", "opening", "fehler", "staerken", "punkte", "tipp",
  ],
  properties: {
    phase: {
      type: "string",
      enum: ["opening", "setting", "closing", "sonstiges"],
      description: "opening = Kaltakquise eines Openers, setting = 15-Min.-Erstgespräch, closing = Strategiegespräch, sonstiges = alles andere",
    },
    zusammenfassung: s("2–4 Sätze, bei sehr kurzen Calls 1 Satz"),
    ergebnis: s("Kurz, z. B. „Setting gelegt“, „abgewimmelt vom Gatekeeper“, „kein Interesse“, „Closing gelegt“"),
    entscheider_erreicht: { type: "boolean", description: "Geschäftsführer/Inhaber selbst am Telefon" },
    termin_vereinbart: { type: "boolean", description: "Fester nächster Termin (Setting bzw. Closing) vereinbart" },
    einwaende: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kategorie", "zitat", "sekunde", "reaktion", "reaktion_gut"],
        properties: {
          kategorie: s("Kurzes Schlagwort, möglichst aus der Liste im Systemprompt"),
          zitat: s("Wörtlich, kurz"),
          sekunde: { type: "integer", description: "Startzeit laut Zeitmarke" },
          reaktion: s("Wie der Mitarbeiter reagiert hat, kurz"),
          reaktion_gut: { type: "boolean" },
        },
      },
    },
    opening: {
      ...nullbar({
        type: "object",
        additionalProperties: false,
        required: ["abbruch_sekunde", "abbruch_grund", "hook_funktioniert", "gatekeeper"],
        properties: {
          abbruch_sekunde: nullbar({ type: "integer", description: "Sekunde, ab der der Angerufene abblockt/auflegt; null wenn kein Abbruch" }),
          abbruch_grund: nullbar(s("Warum abgebrochen, kurzes Schlagwort")),
          hook_funktioniert: { type: "boolean", description: "Einstieg hat Interesse geweckt (Gespräch ging weiter)" },
          gatekeeper: { type: "boolean", description: "Zuerst Sekretariat/Mitarbeiter statt Entscheider" },
        },
      }),
      description: "Nur bei phase = opening, sonst null",
    },
    fehler: {
      type: "array",
      description: "0–5 wichtigste Fehler, schwerster zuerst",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fehler", "zitat", "sekunde", "besser"],
        properties: {
          fehler: s("Was falsch lief, konkret"),
          zitat: s("Wörtlich, kurz"),
          sekunde: { type: "integer" },
          besser: s("Bessere Formulierung bzw. was stattdessen"),
        },
      },
    },
    staerken: { type: "array", items: { type: "string" }, description: "0–3 Dinge, die gut liefen" },
    punkte: { type: "integer", description: "Gesprächsführung 0–100" },
    tipp: s("Ein konkreter Tipp fürs nächste Gespräch"),
  },
} as const;

/** Rohtext der KI → geprüfte Analyse (wirft bei ungültigem JSON/Schema) */
export function pruefeAnalyse(roh: unknown): Analyse {
  const wert = typeof roh === "string" ? JSON.parse(roh) : roh;
  const a = AnalyseSchema.parse(wert);
  return a.phase === "opening" ? a : { ...a, opening: null };
}

// ---------------------------------------------------------------------------
// Auswertungen für die Seite
// ---------------------------------------------------------------------------

export interface GespraechZeile {
  call_id: string;
  user_name: string | null;
  dauer_sek: number | null;
  phase: Phase;
  status: Status;
  punkte: number | null;
  ergebnis: Analyse | null;
}

export const endPhase = (g: Pick<GespraechZeile, "phase" | "ergebnis">): Phase => g.ergebnis?.phase ?? g.phase;
const analysiert = <T extends GespraechZeile>(xs: T[]) => xs.filter((g) => g.status === "analysiert" && g.ergebnis);
const schnitt = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const anteil = (teil: number, von: number) => (von ? teil / von : null);

export function kennzahlen(xs: GespraechZeile[]) {
  const a = analysiert(xs);
  return {
    gesamt: xs.length,
    analysiert: a.length,
    schnittPunkte: schnitt(a.map((g) => g.ergebnis!.punkte)),
    entscheiderQuote: anteil(a.filter((g) => g.ergebnis!.entscheider_erreicht).length, a.length),
  };
}

/** „Schon Agentur“, „schon agentur.“ → „schon agentur“ */
export function normalisiere(text: string): string {
  return text.toLowerCase().replace(/[„“"'.!?…]/g, "").replace(/\s+/g, " ").trim();
}

/** Häufigstes Original-Label je Schlüssel, Großschreibung am Anfang */
function anzeige(labels: string[]): string {
  const m = new Map<string, number>();
  for (const l of labels) m.set(l.trim(), (m.get(l.trim()) ?? 0) + 1);
  const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return best.charAt(0).toUpperCase() + best.slice(1);
}

export interface EinwandRang {
  kategorie: string;
  anzahl: number;
  gutAnteil: number | null;
  beispiel: string;
}

/** Einwände einer Phase nach Häufigkeit (je Gespräch und Kategorie einmal gezählt) */
export function einwandRanking(xs: GespraechZeile[], phase: Phase): EinwandRang[] {
  const m = new Map<string, { labels: string[]; anzahl: number; gut: number; beispiel: string }>();
  for (const g of analysiert(xs).filter((x) => endPhase(x) === phase)) {
    const gesehen = new Set<string>();
    for (const e of g.ergebnis!.einwaende) {
      const k = normalisiere(e.kategorie) || "sonstiges";
      const r = m.get(k) ?? { labels: [], anzahl: 0, gut: 0, beispiel: "" };
      r.labels.push(e.kategorie);
      if (!gesehen.has(k)) {
        gesehen.add(k);
        r.anzahl++;
        if (e.reaktion_gut) r.gut++;
      }
      if (!r.beispiel && e.zitat.trim()) r.beispiel = e.zitat.trim();
      m.set(k, r);
    }
  }
  return [...m.values()]
    .map((r) => ({ kategorie: anzeige(r.labels), anzahl: r.anzahl, gutAnteil: anteil(r.gut, r.anzahl), beispiel: r.beispiel }))
    .sort((a, b) => b.anzahl - a.anzahl || a.kategorie.localeCompare(b.kategorie));
}

export const ABBRUCH_BUCKETS = ["0–10 s", "10–30 s", "30–60 s", "> 60 s"] as const;

export function abbruchBucket(sek: number): (typeof ABBRUCH_BUCKETS)[number] {
  if (sek < 10) return "0–10 s";
  if (sek < 30) return "10–30 s";
  if (sek < 60) return "30–60 s";
  return "> 60 s";
}

/**
 * Wann Openings enden: analysiert → Abbruch-Sekunde laut KI (null = kein Abbruch),
 * nicht analysiert (kurze Calls werden nicht hochgeladen) → Gesprächsdauer als Abbruchzeitpunkt.
 */
export function abbruchVerteilung(xs: GespraechZeile[]) {
  const buckets = Object.fromEntries(ABBRUCH_BUCKETS.map((b) => [b, 0])) as Record<(typeof ABBRUCH_BUCKETS)[number], number>;
  let keinAbbruch = 0;
  for (const g of xs.filter((x) => endPhase(x) === "opening")) {
    if (g.status === "analysiert" && g.ergebnis?.opening) {
      const sek = g.ergebnis.opening.abbruch_sekunde;
      if (sek === null) keinAbbruch++;
      else buckets[abbruchBucket(sek)]++;
    } else if (g.status !== "analysiert" && g.dauer_sek !== null) {
      buckets[abbruchBucket(g.dauer_sek)]++;
    }
  }
  return { buckets, keinAbbruch };
}

/** Häufigste Abbruchgründe im Opening */
export function abbruchGruende(xs: GespraechZeile[]): Array<{ grund: string; anzahl: number }> {
  const m = new Map<string, string[]>();
  for (const g of analysiert(xs).filter((x) => endPhase(x) === "opening")) {
    const grund = g.ergebnis!.opening?.abbruch_grund;
    if (!grund?.trim()) continue;
    const k = normalisiere(grund);
    m.set(k, [...(m.get(k) ?? []), grund]);
  }
  return [...m.values()].map((l) => ({ grund: anzeige(l), anzahl: l.length })).sort((a, b) => b.anzahl - a.anzahl);
}

export interface OpenerWert {
  name: string;
  calls: number;
  analysiert: number;
  schnittPunkte: number | null;
  hookQuote: number | null;
  terminQuote: number | null;
  entscheiderQuote: number | null;
  gatekeeperQuote: number | null;
}

/** Opening-Kennzahlen je Opener (Calls inkl. nicht analysierter) */
export function openerVergleich(xs: GespraechZeile[]): OpenerWert[] {
  const m = new Map<string, GespraechZeile[]>();
  for (const g of xs.filter((x) => endPhase(x) === "opening")) {
    const k = g.user_name ?? "Unbekannt";
    m.set(k, [...(m.get(k) ?? []), g]);
  }
  return [...m.entries()]
    .map(([name, liste]) => {
      const a = analysiert(liste);
      const mitOpening = a.filter((g) => g.ergebnis!.opening);
      return {
        name,
        calls: liste.length,
        analysiert: a.length,
        schnittPunkte: schnitt(a.map((g) => g.ergebnis!.punkte)),
        hookQuote: anteil(mitOpening.filter((g) => g.ergebnis!.opening!.hook_funktioniert).length, mitOpening.length),
        terminQuote: anteil(a.filter((g) => g.ergebnis!.termin_vereinbart).length, a.length),
        entscheiderQuote: anteil(a.filter((g) => g.ergebnis!.entscheider_erreicht).length, a.length),
        gatekeeperQuote: anteil(mitOpening.filter((g) => g.ergebnis!.opening!.gatekeeper).length, mitOpening.length),
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

/** Hook funktioniert über alle analysierten Openings */
export function hookQuote(xs: GespraechZeile[]): number | null {
  const o = analysiert(xs).filter((g) => endPhase(g) === "opening" && g.ergebnis!.opening);
  return anteil(o.filter((g) => g.ergebnis!.opening!.hook_funktioniert).length, o.length);
}
