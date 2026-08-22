export interface SalesKpis {
  leadsNeu: number;
  gespraeche: number;
  termineGebucht: number;
  termineWahrgenommen: number;
  termineAbgesagt: number;
  noShows: number;
  showRate: number;
  noShowRate: number;
  absageRate: number;
  angebote: number;
  closes: number;
  closingsProTermin: number; // Closes / Termine wahrgenommen
  umsatz: number;
  avgDealgroesse: number;
  closingRate: number; // Closes / Termine wahrgenommen
  costPerClosingCall: number; // Ad-Spend / Termine wahrgenommen
  costPerClose: number; // Ad-Spend / Closes (CAC)
  revenuePerLead: number; // Umsatz / Leads
}

export interface PersonStats {
  closeId: string;
  name: string;
  email: string;
  rolle: string;
  // Opener/Setter
  anrufeGesamt: number;
  anrufeErreicht: number;
  gespraechsquote: number;
  avgGespraechsdauer: number;
  gespraechszeitGesamt: number;
  termineGesetzt: number;
  termineProHundert: number;
  showRateEigen: number;
  closesAusEigenen: number;
  umsatzAusEigenen: number;
  // Closer
  termineWahrgenommen: number;
  angebote: number;
  closes: number;
  closingRate: number;
  umsatz: number;
  avgDealgroesse: number;
  avgZeitBisClose: number; // Tage von Termin bis Close
  costPerClosingCall: number;
}

export interface CalendlyStats {
  gesamt: number;
  stattgefunden: number;
  abgesagt: number;
  noShow: number;
  absageQuote: number;
  noShowRate: number;
  absagegruende: { grund: string; anzahl: number }[];
  absagenNachVorlauf: {
    ueber24h: number;
    unter24h: number;
    unter2h: number;
  };
  absagenNachPartei: {
    invitee: number;
    host: number;
  };
  slotHeatmap: { tag: number; stunde: number; count: number }[];
}

export interface FunnelStep {
  label: string;
  count: number;
  conversionFromPrev: number | null;
}

export const TAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

export function formatSeconds(s: number): string {
  const min = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (min < 60) return `${min}:${sec.toString().padStart(2, "0")}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatEuro(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDays(days: number): string {
  if (days < 1) return "< 1 Tag";
  if (days === 1) return "1 Tag";
  return `${Math.round(days)} Tage`;
}

export function categorizeCancelReason(reason: string | null): string {
  if (!reason || reason.trim() === "") return "Kein Grund angegeben";
  const lower = reason.toLowerCase().trim();

  if (lower.includes("verschoben") || lower.includes("verschieben"))
    return "Verschoben";
  if (lower.includes("krank") || lower.includes("gesundheit") || lower.includes("krankmeldung"))
    return "Krankheit";
  if (lower.includes("kein interesse") || lower.includes("keine interesse") || lower.includes("kein intresse") || lower.includes("kein bedarf") || lower.includes("keine bedarf") || lower.includes("nicht relevant") || lower.includes("momentan nicht"))
    return "Kein Interesse";
  if (lower.includes("baustelle") || lower.includes("arbeit") || lower.includes("kunde") || lower.includes("büro") || lower.includes("rohrbruch") || lower.includes("auswärts"))
    return "Baustelle / Arbeit";
  if (lower.includes("keine zeit") || lower.includes("kein zeit") || lower.includes("zeit-not") || lower.includes("dazwischen") || lower.includes("wichtigen termin") || lower.includes("stau"))
    return "Keine Zeit";
  if (lower.includes("mitbewerber") || lower.includes("andere firma") || lower.includes("anderer anbieter") || lower.includes("agentur") || lower.includes("bereits") || lower.includes("homepage neu"))
    return "Anderer Anbieter";
  if (lower.includes("dopplung") || lower.includes("doppelbuchung") || lower.includes("falsche mail") || lower.includes("keine mail"))
    return "Dopplung / Technik";
  if (lower.includes("urlaub"))
    return "Urlaub";
  if (lower.includes("nicht anwesend") || lower.includes("nicht bestätigt") || lower.includes("abgesagt"))
    return "Nicht erschienen";

  return "Sonstiges";
}
