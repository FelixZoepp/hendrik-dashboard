import type { LeadStatus, SlaAmpel } from "@/lib/types/database";

export const LEAD_STATUS_CONFIG: Record<
  LeadStatus,
  { label: string; color: string; order: number }
> = {
  neu: { label: "Neu", color: "bg-blue-100 text-blue-800", order: 0 },
  kontaktiert: {
    label: "Kontaktiert",
    color: "bg-sky-100 text-sky-800",
    order: 1,
  },
  termin_vereinbart: {
    label: "Termin vereinbart",
    color: "bg-indigo-100 text-indigo-800",
    order: 2,
  },
  vor_ort_termin: {
    label: "Vor-Ort-Termin",
    color: "bg-violet-100 text-violet-800",
    order: 3,
  },
  angebot_raus: {
    label: "Angebot raus",
    color: "bg-amber-100 text-amber-800",
    order: 4,
  },
  gewonnen: {
    label: "Gewonnen",
    color: "bg-emerald-100 text-emerald-800",
    order: 5,
  },
  verloren: {
    label: "Verloren",
    color: "bg-red-100 text-red-800",
    order: 6,
  },
  kein_interesse: {
    label: "Kein Interesse",
    color: "bg-gray-100 text-gray-600",
    order: 7,
  },
  nicht_erreicht: {
    label: "Nicht erreicht",
    color: "bg-orange-100 text-orange-700",
    order: 8,
  },
};

// Kanban-Spalten: nur die aktiven Pipeline-Status
export const KANBAN_COLUMNS: LeadStatus[] = [
  "neu",
  "kontaktiert",
  "termin_vereinbart",
  "vor_ort_termin",
  "angebot_raus",
  "gewonnen",
  "verloren",
];

export const VERLUST_GRUENDE = [
  { value: "zu_teuer", label: "Zu teuer" },
  { value: "kein_bedarf_mehr", label: "Kein Bedarf mehr" },
  { value: "anderer_anbieter", label: "Anderer Anbieter" },
  { value: "nicht_erreicht", label: "Nicht erreicht" },
  { value: "unpassende_anfrage", label: "Unpassende Anfrage" },
] as const;

export const LEAD_QUELLEN = [
  { value: "google_ads", label: "Google Ads" },
  { value: "onepage", label: "OnePage" },
  { value: "manuell", label: "Manuell" },
  { value: "empfehlung", label: "Empfehlung" },
] as const;

export function getLeadAge(createdAt: string): {
  label: string;
  ampel: SlaAmpel;
} {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const diffMin = diffMs / 60000;

  if (diffMin < 15) return { label: formatDuration(diffMs), ampel: "gruen" };
  if (diffMin < 60) return { label: formatDuration(diffMs), ampel: "gelb" };
  return { label: formatDuration(diffMs), ampel: "rot" };
}

export function getReaktionszeit(
  createdAt: string,
  firstContactAt: string | null
): { label: string; ampel: SlaAmpel; minuten: number } {
  if (firstContactAt) {
    const diffMs =
      new Date(firstContactAt).getTime() - new Date(createdAt).getTime();
    const minuten = diffMs / 60000;
    const ampel: SlaAmpel =
      minuten < 15 ? "gruen" : minuten < 60 ? "gelb" : "rot";
    return { label: formatDuration(diffMs), ampel, minuten };
  }

  const diffMs = Date.now() - new Date(createdAt).getTime();
  const minuten = diffMs / 60000;
  const ampel: SlaAmpel =
    minuten < 15 ? "gruen" : minuten < 60 ? "gelb" : "rot";
  return { label: formatDuration(diffMs), ampel, minuten };
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin} Min.`;

  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours < 24) return `${hours}h ${min}m`;

  const days = Math.floor(hours / 24);
  return `${days}T ${hours % 24}h`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
