/**
 * Onboarding „Dein Start in der Cloud“ — reine Logik ohne I/O
 * (scripts/test-onboarding.mjs lädt die Datei direkt mit Node).
 *
 * Jeder Schritt wird automatisch aus vorhandenen Daten erkannt (siehe src/lib/onboarding/daten.ts):
 *   after_close  form_submissions (typ after_close) der Firma
 *   zugaenge     form_submissions (typ zugaenge) der Firma
 *   kalender     kalender_abos: Link erzeugt + vom Kalender einmal abgerufen (Migration 00019)
 *   anfrage      mindestens ein (echter) Lead der Firma
 *   bearbeitet   ein Lead mit erstem Kontakt (first_contact_at) bzw. aus „Neu“ weiterbewegt
 *   lektion      eine erledigte Masterclass-Lektion (lesson_progress) einer Person der Firma
 */

export type SchrittId = "after_close" | "zugaenge" | "kalender" | "anfrage" | "bearbeitet" | "lektion";

/** Kalender-Stand: null = unbekannt (Tabelle fehlt, Migration 00019 noch nicht eingespielt). */
export type KalenderStand = "kein_link" | "link_erzeugt" | "verbunden" | null;

export interface OnboardingDaten {
  afterClose: boolean;
  zugaenge: boolean;
  kalender: KalenderStand;
  anfragen: number;
  bearbeitet: boolean;
  /** Erste noch unbearbeitete Anfrage (für den Knopf „Jetzt bearbeiten“) */
  offeneAnfrageId?: string | null;
  lektion: boolean;
}

export interface OnboardingSchritt {
  id: SchrittId;
  titel: string;
  erledigt: boolean;
  /** Kurzer Satz unter dem Titel */
  hinweis: string;
  /** Ziel des Knopfs (nur wenn offen und es etwas zu tun gibt) */
  href: string | null;
  knopf: string | null;
  /** true = Bereich wird noch eingerichtet (Datenbank-Update fehlt) */
  einrichtung?: boolean;
}

export interface OnboardingStand {
  schritte: OnboardingSchritt[];
  erledigt: number;
  gesamt: number;
  prozent: number;
  fertig: boolean;
  /** Erster offener Schritt (für „Als Nächstes“) */
  naechster: OnboardingSchritt | null;
}

export const LEERE_DATEN: OnboardingDaten = {
  afterClose: false,
  zugaenge: false,
  kalender: "kein_link",
  anfragen: 0,
  bearbeitet: false,
  offeneAnfrageId: null,
  lektion: false,
};

export function onboardingSchritte(d: OnboardingDaten): OnboardingSchritt[] {
  const kalenderFehlt = d.kalender === null;
  const kalenderFertig = d.kalender === "verbunden";
  const anfrageDa = d.anfragen > 0;
  // Bearbeitet ohne Anfrage ist nicht möglich – Daten sicherheitshalber gerade ziehen
  const bearbeitet = anfrageDa && d.bearbeitet;

  return [
    {
      id: "after_close",
      titel: "Startformular ausfüllen",
      erledigt: d.afterClose,
      hinweis: d.afterClose ? "Deine Firmendaten sind da." : "Firmendaten, Leistungen und Gebiet – dauert 5 Minuten.",
      href: d.afterClose ? null : "/forms/after-close",
      knopf: d.afterClose ? null : "Formular ausfüllen",
    },
    {
      id: "zugaenge",
      titel: "Zugänge schicken",
      erledigt: d.zugaenge,
      hinweis: d.zugaenge ? "Zugänge sind bei uns angekommen." : "Domain, Google und Meta – damit wir loslegen können.",
      href: d.zugaenge ? null : "/forms/zugaenge",
      knopf: d.zugaenge ? null : "Zugänge eintragen",
    },
    {
      id: "kalender",
      titel: "Kalender verbinden",
      erledigt: kalenderFertig,
      einrichtung: kalenderFehlt || undefined,
      hinweis: kalenderFehlt
        ? "Wird eingerichtet."
        : kalenderFertig
          ? "Termine und Rückrufe landen in deinem Handy-Kalender."
          : d.kalender === "link_erzeugt"
            ? "Link ist da – jetzt noch im Kalender eintragen."
            : "Termine und Rückrufe automatisch im Handy-Kalender.",
      href: kalenderFehlt || kalenderFertig ? null : "/kalender",
      knopf: kalenderFehlt || kalenderFertig ? null : d.kalender === "link_erzeugt" ? "Weiter verbinden" : "Kalender verbinden",
    },
    {
      id: "anfrage",
      titel: "Erste Anfrage bekommen",
      erledigt: anfrageDa,
      hinweis: anfrageDa
        ? `${d.anfragen} ${d.anfragen === 1 ? "Anfrage" : "Anfragen"} eingegangen.`
        : "Kommt automatisch, sobald deine Werbung läuft.",
      href: anfrageDa ? null : "/kampagne",
      knopf: anfrageDa ? null : "Kampagne ansehen",
    },
    {
      id: "bearbeitet",
      titel: "Erste Anfrage bearbeiten",
      erledigt: bearbeitet,
      hinweis: bearbeitet
        ? "Stark – der erste Kontakt ist eingetragen."
        : anfrageDa
          ? "Anrufen und eintragen, wie es lief."
          : "Sobald die erste Anfrage da ist: schnell anrufen.",
      href: bearbeitet || !anfrageDa ? null : d.offeneAnfrageId ? `/leads/${d.offeneAnfrageId}` : "/leads",
      knopf: bearbeitet || !anfrageDa ? null : "Jetzt bearbeiten",
    },
    {
      id: "lektion",
      titel: "Erste Masterclass-Lektion",
      erledigt: d.lektion,
      hinweis: d.lektion ? "Die erste Lektion ist erledigt." : "Kurzes Video: so wird aus Anfragen ein Auftrag.",
      href: d.lektion ? null : "/akademie",
      knopf: d.lektion ? null : "Lektion ansehen",
    },
  ];
}

export function onboardingStand(d: OnboardingDaten): OnboardingStand {
  const schritte = onboardingSchritte(d);
  const erledigt = schritte.filter((s) => s.erledigt).length;
  const gesamt = schritte.length;
  return {
    schritte,
    erledigt,
    gesamt,
    prozent: Math.round((erledigt / gesamt) * 100),
    fertig: erledigt === gesamt,
    naechster: schritte.find((s) => !s.erledigt && !s.einrichtung) ?? null,
  };
}

/** Kalender-Stand aus der kalender_abos-Zeile (undefined/null = keine Zeile). */
export function kalenderStandAus(zeile: { token: string | null; letzter_abruf_am: string | null } | null | undefined): Exclude<KalenderStand, null> {
  if (!zeile?.token) return "kein_link";
  return zeile.letzter_abruf_am ? "verbunden" : "link_erzeugt";
}
