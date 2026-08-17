export interface SalesKpis {
  leadsNeu: number;
  gespraeche: number;
  termineGebucht: number;
  termineWahrgenommen: number;
  showRate: number;
  angebote: number;
  closes: number;
  umsatz: number;
  avgDealgroesse: number;
  closingRate: number;
}

export interface PersonStats {
  closeId: string;
  name: string;
  rolle: string;
  // Opener/Setter
  anrufeGesamt: number;
  anrufeErreicht: number;
  gespraechsquote: number;
  avgGespraechsdauer: number; // Sekunden
  gespraechszeitGesamt: number; // Sekunden
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
}

export interface CalendlyStats {
  gesamt: number;
  stattgefunden: number;
  abgesagt: number;
  noShow: number;
  absageQuote: number;
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
}

export interface FunnelStep {
  label: string;
  count: number;
  conversionFromPrev: number | null;
}

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
