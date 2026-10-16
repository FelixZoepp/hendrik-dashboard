/**
 * Verlustgrund-Automatik (reine Logik, ohne Imports — das node-Prüfskript lädt die Datei direkt).
 *
 * - Setting „Nicht qualifiziert“/„Disqualifiziert“ bzw. Closing „Unqualifiziert“ setzt die Opportunity
 *   auf „Verloren“ (api/webhooks/close). Steht im Protokoll ein Grund, wandert er ins Opp-Feld „Verlustgrund“.
 * - Ohne Grund (oder Opportunity manuell auf verloren gesetzt) → Close-Aufgabe „Verlustgrund eintragen“.
 * Die Feld-IDs gibt es erst nach „Felder in Close anlegen“ (/sales/verlustgrund) → stehen in wa_einstellungen.
 */

/** Gründe — angelehnt an Hendriks echte Gründe aus den Setting-Notizen. Reihenfolge = Auswahl in Close. */
export const VERLUSTGRUENDE = [
  "Will nicht wachsen / ausgelastet",
  "Kein Budget / nicht liquide",
  "Entscheider fehlt",
  "Kein zeitnaher Start",
  "Mindset / nicht beratbar",
  "Kein Handwerk / passt nicht (Branche)",
  "Sprachbarriere",
  "Hat schon Agentur/Anbieter",
  "Nicht mehr erreichbar (Ghosting)",
  "Sonstiges (Notiz)",
] as const;

export type Verlustgrund = (typeof VERLUSTGRUENDE)[number];

/** Name der neuen Felder in Close (Opportunity und beide Protokolle). */
export const VERLUSTGRUND_FELDNAME = "Verlustgrund";

/** Gesprächsprotokolle (Custom Activity Types) — wie in api/webhooks/close. */
export const PROTOKOLL_TYP = {
  setting: "actitype_41UXYctoK8pqnPD2TvTGoO",
  closing: "actitype_71sdCTlSLsK8bWiC802Bn8",
} as const;

/** Feld „Nächster Schritt“ der Protokolle und die Werte, die die Opportunity auf „Verloren“ setzen. */
export const VERLOREN_REGELN = {
  [PROTOKOLL_TYP.setting]: {
    feld: "custom.cf_6Kt9RVMkQiuDOXBiiTRrKg8DTwvoQn8EEBCXmaTykGZ",
    werte: ["Nicht qualifiziert", "Disqualifiziert"],
  },
  [PROTOKOLL_TYP.closing]: {
    feld: "custom.cf_9vkQK8YANMMZ3lyt0aAZbAnkAxYoB15WwM5sTyr3veM",
    werte: ["Unqualifiziert"],
  },
} as const satisfies Record<string, { feld: string; werte: readonly string[] }>;

export const AUFGABE_PRAEFIX = "❓ Verlustgrund eintragen";

/** Erst nach 30 Min. nachfragen — Zeit, den Grund beim manuellen Verloren-Setzen selbst einzutragen. */
export const KARENZ_MS = 30 * 60_000;
/** Manuell verlorene Opportunities nur prüfen, wenn sie in den letzten 24 Std. geändert wurden. */
export const FENSTER_MS = 24 * 60 * 60_000;
/** Dedupe-Marker so lange aufbewahren. */
export const MARKER_TAGE = 14;

/** Feld-ID als Close-Key: "cf_…" oder "custom.cf_…" → "custom.cf_…"; leer → null. */
export function alsCustomKey(feld: string | null | undefined): string | null {
  const f = (feld ?? "").trim();
  if (!f) return null;
  return f.startsWith("custom.") ? f : `custom.${f}`;
}

/** Ist ein gültiger Verlustgrund (genau einer aus der Liste)? */
export function istVerlustgrund(wert: unknown): wert is Verlustgrund {
  return typeof wert === "string" && (VERLUSTGRUENDE as readonly string[]).includes(wert.trim());
}

/** Ist im Feld schon irgendein Grund eingetragen (Text oder Auswahl, auch Mehrfachauswahl)? */
export function istGrundGesetzt(wert: unknown): boolean {
  if (Array.isArray(wert)) return wert.some((w) => typeof w === "string" && w.trim() !== "");
  return typeof wert === "string" ? wert.trim() !== "" : wert !== null && wert !== undefined;
}

export interface GrundFelder {
  /** "custom.cf_…" des Grund-Felds im Setting-Protokoll (null = noch nicht angelegt) */
  setting: string | null;
  /** "custom.cf_…" des Grund-Felds im Closing-Protokoll */
  closing: string | null;
}

/**
 * Setzt dieses Protokoll die Opportunity auf „Verloren“, und nennt es einen gültigen Grund?
 * Ungültige/unbekannte Werte zählen als „kein Grund“ (Opp-Feld ist eine Auswahl → würde abgelehnt).
 */
export function verlustAusProtokoll(
  protokoll: Record<string, unknown>,
  grundFelder: GrundFelder,
): { verloren: boolean; grund: Verlustgrund | null } {
  const typ = protokoll.custom_activity_type_id as string | undefined;
  const regel = typ ? (VERLOREN_REGELN as Record<string, { feld: string; werte: readonly string[] }>)[typ] : undefined;
  const wert = regel ? protokoll[regel.feld] : undefined;
  if (!regel || typeof wert !== "string" || !regel.werte.includes(wert)) return { verloren: false, grund: null };
  const grundFeld = typ === PROTOKOLL_TYP.setting ? grundFelder.setting : grundFelder.closing;
  const roh = grundFeld ? protokoll[grundFeld] : null;
  const grund = Array.isArray(roh) ? roh[0] : roh;
  return { verloren: true, grund: istVerlustgrund(grund) ? (grund.trim() as Verlustgrund) : null };
}

export function aufgabenText(leadName: string | null | undefined): string {
  const name = (leadName ?? "").trim() || "Deal";
  return `${AUFGABE_PRAEFIX} (${name}): Opportunity öffnen → Feld „${VERLUSTGRUND_FELDNAME}“ auswählen – ohne Grund wissen wir nicht, woran wir verlieren`;
}

/** Gibt es zum Lead schon eine offene Verlustgrund-Aufgabe? */
export function hatOffeneAufgabe(aufgaben: Array<{ text?: string | null; is_complete?: boolean }>): boolean {
  return aufgaben.some((a) => !a.is_complete && (a.text ?? "").startsWith(AUFGABE_PRAEFIX));
}

/** Datum (YYYY-MM-DD) in deutscher Zeit. */
export function berlinerTag(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
}

/** Dedupe-Marker: Opp-ID → Tag der letzten Aufgabe. */
export type AufgabenMarker = Record<string, string>;

/** Pro Opportunity und Tag nur eine Aufgabe. */
export function schonErinnert(marker: AufgabenMarker, oppId: string, tag: string): boolean {
  return marker[oppId] === tag;
}

/** Marker setzen und alte Einträge (> MARKER_TAGE) entfernen. */
export function setzeMarker(marker: AufgabenMarker, oppId: string, tag: string): AufgabenMarker {
  const grenze = new Date(`${tag}T12:00:00Z`).getTime() - MARKER_TAGE * 864e5;
  const neu: AufgabenMarker = {};
  for (const [id, t] of Object.entries(marker)) {
    if (typeof t === "string" && new Date(`${t}T12:00:00Z`).getTime() >= grenze) neu[id] = t;
  }
  neu[oppId] = tag;
  return neu;
}

export interface OppKurz extends Record<string, unknown> {
  id: string;
  status_type?: string;
  date_updated?: string;
}

/**
 * Close-Sync: verlorene Opportunities ohne Grund, die eine Aufgabe brauchen —
 * zuletzt geändert vor mind. 30 Min. und höchstens 24 Std., Feld leer, heute noch nicht erinnert.
 * Fehlt das Feld in der Listenantwort, gilt es als leer (die Opp wird vor der Aufgabe einzeln nachgeladen).
 */
export function offeneVerlusteOhneGrund(
  opps: OppKurz[],
  feld: string,
  marker: AufgabenMarker,
  jetzt: Date,
): OppKurz[] {
  const tag = berlinerTag(jetzt);
  return opps.filter((o) => {
    if (o.status_type !== "lost") return false;
    // date_updated statt date_lost: date_lost ist in Close nur ein Datum ohne Uhrzeit
    const geaendert = Date.parse(o.date_updated ?? "");
    if (!Number.isFinite(geaendert)) return false;
    const alter = jetzt.getTime() - geaendert;
    if (alter < KARENZ_MS || alter > FENSTER_MS) return false;
    if (istGrundGesetzt(o[feld])) return false;
    return !schonErinnert(marker, o.id, tag);
  });
}
