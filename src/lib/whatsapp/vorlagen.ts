/**
 * WhatsApp-Vorlagen des Terminbots — alle Texte an EINER Stelle (Feedback-Runden).
 *
 * Nach einer Textänderung muss die Vorlage bei Meta neu eingereicht werden
 * (bereits freigegebene Vorlagen gleichen Namens lassen sich nicht überschreiben →
 * ggf. neuen Namen vergeben, z. B. hs_erstgespraech_gebucht_v2, und vorlagen_aktiv anpassen).
 *
 * Regeln von Meta (werden von pruefeVorlage() geprüft):
 * Button-Text ≤ 25 Zeichen, Header ≤ 60, Footer ≤ 60, Body ≤ 1024,
 * kein Platzhalter am Anfang/Ende des Bodys, keine zwei Platzhalter direkt nebeneinander.
 *
 * Bewusst ohne Imports, damit die Datei auch im node-Prüfskript läuft.
 */

export type VorlagenName =
  | "hs_erstgespraech_gebucht"
  | "hs_erstgespraech_erinnerung"
  | "hs_erstgespraech_gleich"
  | "hs_strategie_gebucht"
  | "hs_strategie_erinnerung"
  | "hs_strategie_gleich"
  | "hs_termin_verpasst"
  | "hs_termin_abgesagt";

export type VorlagenButton =
  | { typ: "QUICK_REPLY"; text: string; aktion: "bestaetigen" | "verschieben" }
  | { typ: "URL"; text: string; pfad: "t" | "j" | "n" };

/** Welche Werte in {{1}}, {{2}} … landen (Reihenfolge = Platzhalter-Nummer). */
export type VorlagenWert = "name" | "datum" | "uhrzeit" | "tag" | "ort";

export interface VorlageDef {
  name: VorlagenName;
  /** null = für beide Terminarten */
  art: "erstgespraech" | "strategie" | null;
  typ: "gebucht" | "erinnerung" | "gleich" | "verpasst" | "abgesagt";
  kategorie: "UTILITY";
  sprache: "de";
  header?: string;
  body: string;
  footer: string;
  werte: VorlagenWert[];
  beispiele: string[];
  buttons: VorlagenButton[];
}

const FOOTER_STOP = "Hoffmann Solutions GmbH · Abmelden mit STOP";
const FOOTER = "Hoffmann Solutions GmbH";

/** Fester Berater im Strategiegespräch (steht direkt im Vorlagentext). */
export const STRATEGIE_BERATER = "Hendrik Hoffmann";
/** {{4}} in hs_strategie_gebucht, wenn Calendly keinen Ort liefert. */
export const ORT_FALLBACK_STRATEGIE = "Videocall – Link folgt per WhatsApp";

const BUTTONS_BESTAETIGEN = (urlText: string): VorlagenButton[] => [
  { typ: "QUICK_REPLY", text: "Ich bin dabei", aktion: "bestaetigen" },
  { typ: "QUICK_REPLY", text: "Termin verschieben", aktion: "verschieben" },
  { typ: "URL", text: urlText, pfad: "t" },
];

export const VORLAGEN: VorlageDef[] = [
  {
    name: "hs_erstgespraech_gebucht",
    art: "erstgespraech",
    typ: "gebucht",
    kategorie: "UTILITY",
    sprache: "de",
    header: "Ihr Erstgespräch ist eingetragen",
    body:
      "Guten Tag {{1}}, Ihr kostenfreies Erstgespräch mit der Hoffmann Solutions GmbH ist eingetragen.\n\n" +
      "📅 {{2}} um {{3}} Uhr\n" +
      "📞 Telefonat – ein Handwerksberater aus unserem Team ruft Sie an\n\n" +
      "Bitte bestätigen Sie kurz über den Knopf, dass der Termin für Sie passt. Auf der Termin-Seite finden Sie " +
      "ein kurzes Video zum Ablauf und können den Termin in Ihren Kalender eintragen.",
    footer: FOOTER_STOP,
    werte: ["name", "datum", "uhrzeit"],
    beispiele: ["Markus Müller", "Donnerstag, 16.10.", "10:30"],
    buttons: BUTTONS_BESTAETIGEN("Termin, Video & Kalender"),
  },
  {
    name: "hs_erstgespraech_erinnerung",
    art: "erstgespraech",
    typ: "erinnerung",
    kategorie: "UTILITY",
    sprache: "de",
    body:
      "Guten Tag {{1}}, eine kurze Erinnerung an Ihr Erstgespräch mit der Hoffmann Solutions GmbH {{2}} um {{3}} Uhr.\n\n" +
      "Sollte sich an Ihrer Verfügbarkeit etwas geändert haben, geben Sie uns bitte kurz Bescheid. " +
      "In diesem Fall können Sie sich einfach einen neuen passenden Termin buchen.",
    footer: FOOTER_STOP,
    werte: ["name", "tag", "uhrzeit"],
    beispiele: ["Markus Müller", "morgen", "10:30"],
    buttons: BUTTONS_BESTAETIGEN("Termin, Video & Kalender"),
  },
  {
    name: "hs_erstgespraech_gleich",
    art: "erstgespraech",
    typ: "gleich",
    kategorie: "UTILITY",
    sprache: "de",
    body:
      "Guten Tag {{1}}, in 15 Minuten um {{2}} Uhr ruft Sie ein Handwerksberater aus unserem Team für Ihr Erstgespräch mit der Hoffmann Solutions GmbH an. " +
      "Bitte halten Sie Ihr Telefon bereit.",
    footer: FOOTER,
    werte: ["name", "uhrzeit"],
    beispiele: ["Markus Müller", "10:30"],
    buttons: [{ typ: "URL", text: "Termindetails", pfad: "t" }],
  },
  {
    name: "hs_strategie_gebucht",
    art: "strategie",
    typ: "gebucht",
    kategorie: "UTILITY",
    sprache: "de",
    header: "Ihr Strategiegespräch ist eingetragen",
    body:
      `Guten Tag {{1}}, Ihr Strategiegespräch mit ${STRATEGIE_BERATER} ist eingetragen.\n\n` +
      "📅 {{2}} um {{3}} Uhr\n" +
      "📍 {{4}}\n\n" +
      "Bitte bestätigen Sie kurz über den Knopf. Auf der Termin-Seite finden Sie ein kurzes Video zum Ablauf " +
      "und können den Termin in Ihren Kalender eintragen.",
    footer: FOOTER_STOP,
    werte: ["name", "datum", "uhrzeit", "ort"],
    beispiele: ["Markus Müller", "Donnerstag, 16.10.", "10:30", "Videocall über Zoom"],
    buttons: BUTTONS_BESTAETIGEN("Termin, Video & Kalender"),
  },
  {
    name: "hs_strategie_erinnerung",
    art: "strategie",
    typ: "erinnerung",
    kategorie: "UTILITY",
    sprache: "de",
    body:
      `Guten Tag {{1}}, eine kurze Erinnerung an Ihr Strategiegespräch mit ${STRATEGIE_BERATER} {{2}} um {{3}} Uhr.\n\n` +
      "Sollte sich an Ihrer Verfügbarkeit etwas geändert haben, geben Sie uns bitte kurz Bescheid. " +
      "In diesem Fall können Sie sich einfach einen neuen passenden Termin buchen.",
    footer: FOOTER_STOP,
    werte: ["name", "tag", "uhrzeit"],
    beispiele: ["Markus Müller", "morgen", "10:30"],
    buttons: BUTTONS_BESTAETIGEN("Termin, Video & Kalender"),
  },
  {
    name: "hs_strategie_gleich",
    art: "strategie",
    typ: "gleich",
    kategorie: "UTILITY",
    sprache: "de",
    body:
      `Guten Tag {{1}}, in einer Stunde um {{2}} Uhr beginnt Ihr Strategiegespräch mit ${STRATEGIE_BERATER}. ` +
      "Über den Knopf gelangen Sie direkt in das Gespräch.",
    footer: FOOTER,
    werte: ["name", "uhrzeit"],
    beispiele: ["Markus Müller", "10:30"],
    buttons: [{ typ: "URL", text: "Gespräch beitreten", pfad: "j" }],
  },
  {
    name: "hs_termin_verpasst",
    art: null,
    typ: "verpasst",
    kategorie: "UTILITY",
    sprache: "de",
    body:
      "Guten Tag {{1}}, wir haben Sie zu Ihrem Termin am {{2}} um {{3}} Uhr leider nicht erreicht. " +
      "Über den Knopf können Sie einen neuen Termin auswählen.",
    footer: FOOTER_STOP,
    werte: ["name", "datum", "uhrzeit"],
    beispiele: ["Markus Müller", "Donnerstag, 16.10.", "10:30"],
    buttons: [{ typ: "URL", text: "Neuen Termin wählen", pfad: "n" }],
  },
  {
    name: "hs_termin_abgesagt",
    art: null,
    typ: "abgesagt",
    kategorie: "UTILITY",
    sprache: "de",
    body:
      "Guten Tag {{1}}, Ihr Termin mit der Hoffmann Solutions GmbH am {{2}} um {{3}} Uhr wurde abgesagt. " +
      "Falls Sie einen neuen Termin wünschen, können Sie ihn über den Knopf auswählen.",
    footer: FOOTER_STOP,
    werte: ["name", "datum", "uhrzeit"],
    beispiele: ["Markus Müller", "Donnerstag, 16.10.", "10:30"],
    buttons: [{ typ: "URL", text: "Neuen Termin wählen", pfad: "n" }],
  },
];

export const VORLAGEN_NAMEN = VORLAGEN.map((v) => v.name);

/** Freitext-Antworten (nur im offenen 24-h-Fenster). */
export const FREITEXTE = {
  bestaetigt: "Vielen Dank, Ihr Termin ist bestätigt ✅",
  bestaetigtMitVideo:
    "Vielen Dank, Ihr Termin ist bestätigt ✅ Vorab ein kurzes Video, damit Sie wissen, was Sie erwartet.",
  verschiebenMitLink: (link: string) => `Kein Problem. Hier können Sie einen neuen Termin auswählen: ${link}`,
  verschiebenOhneLink: "Kein Problem, wir melden uns heute noch bei Ihnen.",
  stop: "Alles klar, Sie erhalten von uns keine Nachrichten mehr.",
};

/** Texte der Close-Aufgaben. */
export const AUFGABEN = {
  unbestaetigt: "Termin nicht bestätigt – kurz anrufen",
  verschieben: "Lead möchte Termin verschieben",
  beantworten: "WhatsApp beantworten",
};

export function vorlageFuer(art: "erstgespraech" | "strategie", typ: VorlageDef["typ"]): VorlageDef | undefined {
  return VORLAGEN.find((v) => v.typ === typ && (v.art === null || v.art === art));
}

export function vorlageNachName(name: string): VorlageDef | undefined {
  return VORLAGEN.find((v) => v.name === name);
}

/** Body mit eingesetzten Werten (für Protokoll und Close-Notiz). */
export function renderBody(v: VorlageDef, werte: string[]): string {
  return v.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => werte[Number(n) - 1] ?? `{{${n}}}`);
}

/** Beispiel-Token für die Meta-Prüfung der URL-Buttons. */
const BEISPIEL_TOKEN = "Ab3dEf7hJk9mNp";

/** Definition für POST /{waba_id}/message_templates. */
export function metaDefinition(v: VorlageDef, basisUrl: string) {
  const basis = basisUrl.replace(/\/+$/, "");
  const components: Array<Record<string, unknown>> = [];
  if (v.header) components.push({ type: "HEADER", format: "TEXT", text: v.header });
  components.push({ type: "BODY", text: v.body, example: { body_text: [v.beispiele] } });
  components.push({ type: "FOOTER", text: v.footer });
  components.push({
    type: "BUTTONS",
    buttons: v.buttons.map((b) =>
      b.typ === "QUICK_REPLY"
        ? { type: "QUICK_REPLY", text: b.text }
        : {
            type: "URL",
            text: b.text,
            url: `${basis}/${b.pfad}/{{1}}`,
            example: [`${basis}/${b.pfad}/${BEISPIEL_TOKEN}`],
          },
    ),
  });
  return { name: v.name, language: v.sprache, category: v.kategorie, components };
}

/** Prüft die Meta-Regeln. Leere Liste = alles in Ordnung. */
export function pruefeVorlage(v: VorlageDef): string[] {
  const fehler: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(v.name)) fehler.push("Name nur a–z, 0–9, _");
  if (v.header && v.header.length > 60) fehler.push(`Header zu lang (${v.header.length} > 60)`);
  if (v.header && /\{\{/.test(v.header)) fehler.push("Header ohne Platzhalter vorgesehen");
  if (v.footer.length > 60) fehler.push(`Footer zu lang (${v.footer.length} > 60)`);
  if (v.body.length > 1024) fehler.push(`Body zu lang (${v.body.length} > 1024)`);
  const body = v.body.trim();
  if (/^\{\{\d+\}\}/.test(body)) fehler.push("Body beginnt mit Platzhalter");
  if (/\{\{\d+\}\}[.!?]?$/.test(body)) fehler.push("Body endet mit Platzhalter");
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) fehler.push("Zwei Platzhalter direkt nebeneinander");
  const nummern = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const max = nummern.length ? Math.max(...nummern) : 0;
  for (let i = 1; i <= max; i++) if (!nummern.includes(i)) fehler.push(`Platzhalter {{${i}}} fehlt`);
  if (max !== v.werte.length) fehler.push(`Anzahl Werte (${v.werte.length}) ≠ Platzhalter (${max})`);
  if (max !== v.beispiele.length) fehler.push(`Anzahl Beispiele (${v.beispiele.length}) ≠ Platzhalter (${max})`);
  for (const b of v.buttons) if (b.text.length > 25) fehler.push(`Button „${b.text}“ zu lang (${b.text.length} > 25)`);
  if (v.buttons.filter((b) => b.typ === "URL").length > 2) fehler.push("Höchstens 2 URL-Buttons");
  if (v.buttons.length > 10) fehler.push("Höchstens 10 Buttons");
  return fehler;
}
