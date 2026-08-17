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
  if (!reason) return "Kein Grund angegeben";
  const lower = reason.toLowerCase();

  if (lower.includes("termin") || lower.includes("zeit") || lower.includes("passt nicht"))
    return "Terminkonflikt";
  if (lower.includes("krank") || lower.includes("gesundheit"))
    return "Krankheit";
  if (lower.includes("interesse") || lower.includes("kein bedarf"))
    return "Kein Interesse mehr";
  if (lower.includes("ander") || lower.includes("woanders"))
    return "Anderer Anbieter";
  if (lower.includes("vergessen") || lower.includes("forgot"))
    return "Vergessen";

  return "Sonstiges";
}
