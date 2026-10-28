// Reine Zugriffslogik (ohne Next-Imports) — von proxy.ts, kontext.ts und scripts/test-kontext.mjs genutzt.

export type Rolle = "admin" | "sales" | "fulfillment" | "client_owner" | "client_member";

export const TEAM_ROLLEN: readonly Rolle[] = ["admin", "sales", "fulfillment"];
export const KUNDEN_ROLLEN: readonly Rolle[] = ["client_owner", "client_member"];

/** Name des httpOnly-Cookies „Als Kunde ansehen“ (Wert = companies.id). */
export const ANSICHT_COOKIE = "hs_ansicht_kunde";
export const ANSICHT_MAX_ALTER_SEKUNDEN = 8 * 60 * 60;

/** Name des httpOnly-Cookies „Als Mitarbeiter ansehen“ (Wert = sales | fulfillment). Nur für Admins wirksam. */
export const ROLLEN_ANSICHT_COOKIE = "hs_ansicht_rolle";
export const ANSICHT_ROLLEN: readonly Rolle[] = ["sales", "fulfillment"];

/**
 * Mit welcher Rolle wird die Anfrage behandelt? Ein Admin kann sich die Cloud als
 * Sales- oder Fulfillment-Mitarbeiter ansehen (nur weniger Rechte, nie mehr).
 */
export function wirksameRolle(echteRolle: Rolle, cookieWert: string | null | undefined): Rolle {
  if (echteRolle !== "admin") return echteRolle;
  return ANSICHT_ROLLEN.includes(cookieWert as Rolle) ? (cookieWert as Rolle) : echteRolle;
}

export function istTeamRolle(rolle: string | null | undefined): rolle is Rolle {
  return TEAM_ROLLEN.includes(rolle as Rolle);
}

export function istKundenRolle(rolle: string | null | undefined): rolle is Rolle {
  return KUNDEN_ROLLEN.includes(rolle as Rolle);
}

export function startseiteFuer(rolle: Rolle): string {
  if (rolle === "fulfillment") return "/fulfillment";
  if (istTeamRolle(rolle)) return "/sales";
  return "/dashboard";
}

/**
 * Pfad-Präfixe je Bereich. Neue Seiten in src/app/(agency) bzw. src/app/(client)
 * hier eintragen, damit auch der Proxy (nicht nur das Layout) den Bereich kennt.
 */
export const TEAM_PRAEFIXE: readonly string[] = [
  "/sales",
  "/marketing",
  "/fulfillment",
  "/kunden",
  "/team",
  "/sops",
  "/inhalte",
  "/sla",
];

export const KUNDEN_PRAEFIXE: readonly string[] = [
  "/dashboard",
  "/leads",
  "/status",
  "/akademie",
  "/downloads",
  "/kampagne",
  "/auswertung",
];

/** Team-Seiten, die nur bestimmte Team-Rollen sehen dürfen. */
export const TEAM_PFAD_ROLLEN: Record<string, readonly Rolle[]> = {
  "/team": ["admin"],
  "/sla": ["admin"],
  "/marketing": ["admin"],
  "/sales": ["admin", "sales"],
  "/fulfillment": ["admin", "fulfillment"],
};

/** Nur fürs Team, aber kein Seitenbereich (kein Layout, das schützt). */
const TEAM_API_PRAEFIXE = ["/api/debug"];

const OEFFENTLICHE_PRAEFIXE = [
  "/api/webhooks/",
  "/api/cron/",
  "/api/auth/",
  "/api/automation/", // eigenes CRON_SECRET
  "/b/",
  "/j/",
  "/n/",
  "/t/",
  "/reports/",
  "/_next/",
];

const OEFFENTLICHE_SEITEN = ["/login", "/passwort-setzen"];

const STATISCHE_DATEI = /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|txt|xml|webmanifest|woff2?|ttf|css|js|map)$/i;

function passt(pfad: string, praefix: string): boolean {
  const p = praefix.endsWith("/") ? praefix.slice(0, -1) : praefix;
  return pfad === p || pfad.startsWith(p + "/");
}

/** Pfade ohne Login (Webhooks, Crons, Token-Links, statische Dateien, Login selbst). */
export function istOeffentlicherPfad(pfad: string): boolean {
  if (OEFFENTLICHE_SEITEN.some((s) => passt(pfad, s))) return true;
  if (OEFFENTLICHE_PRAEFIXE.some((p) => passt(pfad, p))) return true;
  return STATISCHE_DATEI.test(pfad);
}

export type Bereich = "oeffentlich" | "start" | "team" | "kunde" | "team_api" | "api" | "allgemein";

export function bereichFuer(pfad: string): Bereich {
  if (istOeffentlicherPfad(pfad)) return "oeffentlich";
  if (pfad === "/") return "start";
  if (TEAM_API_PRAEFIXE.some((p) => passt(pfad, p))) return "team_api";
  if (passt(pfad, "/api")) return "api";
  if (TEAM_PRAEFIXE.some((p) => passt(pfad, p))) return "team";
  if (KUNDEN_PRAEFIXE.some((p) => passt(pfad, p))) return "kunde";
  return "allgemein";
}

/** Nur relative Pfade derselben Seite als Rücksprungziel (kein Open Redirect). */
export function sichererZielpfad(ziel: string | null | undefined, standard = "/"): string {
  if (!ziel || !ziel.startsWith("/") || ziel.startsWith("//")) return standard;
  // Steuerzeichen, Leerraum und Backslash: Browser entfernen/normalisieren sie (z. B. "/\t/boese.de" → "//boese.de").
  if (/[\u0000-\u0020\u007f-\u00a0\\]/.test(ziel)) return standard;
  const BASIS = "https://x.invalid";
  let url: URL;
  try {
    url = new URL(ziel, BASIS);
  } catch {
    return standard;
  }
  if (url.origin !== BASIS) return standard;
  const pfad = url.pathname + url.search + url.hash;
  if (!pfad.startsWith("/") || pfad.startsWith("//") || passt(url.pathname, "/login")) return standard;
  return pfad;
}

export interface ZugriffEingabe {
  pfad: string;
  /** Pfad + Query für ?next= */
  vollerPfad?: string;
  angemeldet: boolean;
  profil: { rolle: Rolle; aktiv: boolean } | null;
  /** Impersonations-Cookie vorhanden (Gültigkeit prüft das Kunden-Layout). */
  ansichtGesetzt: boolean;
}

export type ZugriffEntscheidung =
  | { typ: "weiter" }
  | { typ: "umleiten"; ziel: string }
  | { typ: "abmelden"; ziel: string }
  | { typ: "nicht_angemeldet" }
  | { typ: "verboten" };

export function entscheideZugriff(e: ZugriffEingabe): ZugriffEntscheidung {
  const bereich = bereichFuer(e.pfad);
  if (bereich === "oeffentlich") {
    if (e.pfad === "/login" && e.angemeldet && e.profil?.aktiv) {
      return { typ: "umleiten", ziel: startseiteFuer(e.profil.rolle) };
    }
    return { typ: "weiter" };
  }

  const istApi = bereich === "api" || bereich === "team_api";
  if (!e.angemeldet) {
    if (istApi) return { typ: "nicht_angemeldet" };
    const next = e.vollerPfad ?? e.pfad;
    return { typ: "umleiten", ziel: next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}` };
  }
  if (!e.profil || !e.profil.aktiv) return { typ: "abmelden", ziel: "/login?fehler=gesperrt" };

  const { rolle } = e.profil;
  const team = istTeamRolle(rolle);

  switch (bereich) {
    case "start":
      return { typ: "umleiten", ziel: startseiteFuer(rolle) };
    case "team_api":
      return team ? { typ: "weiter" } : { typ: "verboten" };
    case "team": {
      if (!team) return { typ: "umleiten", ziel: startseiteFuer(rolle) };
      const eintrag = Object.entries(TEAM_PFAD_ROLLEN).find(([p]) => passt(e.pfad, p));
      if (eintrag && !eintrag[1].includes(rolle)) return { typ: "umleiten", ziel: startseiteFuer(rolle) };
      return { typ: "weiter" };
    }
    case "kunde":
      if (team && !e.ansichtGesetzt) return { typ: "umleiten", ziel: "/kunden?hinweis=ansicht" };
      return { typ: "weiter" };
    default:
      return { typ: "weiter" };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function istUuid(wert: string | null | undefined): wert is string {
  return !!wert && UUID.test(wert);
}

/**
 * Welche Firma gilt für diese Anfrage?
 * Kunde → immer die eigene company_id (Cookie wird ignoriert).
 * Team → Impersonations-Cookie, aber nur mit gültiger UUID und existierender Firma.
 */
export function wirksameFirma(e: {
  rolle: Rolle;
  eigeneCompanyId: string | null;
  cookieWert: string | null | undefined;
  firmaExistiert: boolean;
}): { companyId: string | null; impersoniert: boolean } {
  if (!istTeamRolle(e.rolle)) return { companyId: e.eigeneCompanyId ?? null, impersoniert: false };
  if (istUuid(e.cookieWert) && e.firmaExistiert) return { companyId: e.cookieWert, impersoniert: true };
  return { companyId: null, impersoniert: false };
}

/** Wer darf wen als Zugang anlegen / deaktivieren? */
export function darfZugangVerwalten(handelnd: Rolle, zielRolle: Rolle): boolean {
  if (handelnd === "admin") return true;
  return istTeamRolle(handelnd) && istKundenRolle(zielRolle);
}

/**
 * Bestehendes Profil darf beim Zugang-Anlegen nicht still umgebaut werden:
 * Team-Profil nie zur Kundenrolle, Kundenzugang nie in eine andere Firma umhängen.
 * Ergebnis: null = in Ordnung, "team_zu_kunde" oder "andere_firma".
 */
export function zugangUmbauGesperrt(
  alt: { rolle: string; companyId: string | null } | null,
  neu: { rolle: Rolle; companyId: string | null },
): "team_zu_kunde" | "andere_firma" | null {
  if (!alt) return null;
  if (istTeamRolle(alt.rolle) && istKundenRolle(neu.rolle)) return "team_zu_kunde";
  if (istKundenRolle(alt.rolle) && istKundenRolle(neu.rolle) && alt.companyId && alt.companyId !== neu.companyId) return "andere_firma";
  return null;
}
