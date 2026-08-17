"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { LeadSla, Company, SlaAmpel } from "@/lib/types/database";

interface SlaOverviewProps {
  slaData: LeadSla[];
  companies: Company[];
}

const AMPEL_STYLES: Record<SlaAmpel, string> = {
  gruen: "text-sla-gruen",
  gelb: "text-sla-gelb",
  rot: "text-sla-rot",
};

const AMPEL_BG: Record<SlaAmpel, string> = {
  gruen: "bg-sla-gruen/15",
  gelb: "bg-sla-gelb/15",
  rot: "bg-sla-rot/15",
};

interface CompanyStats {
  companyId: string;
  companyName: string;
  totalLeads: number;
  avgReaktionszeit: number;
  medianReaktionszeit: number;
  unter15Min: number;
  unter15MinAnteil: number;
  ueber24hUnbearbeitet: number;
  abschlussquote: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function SlaOverview({ slaData, companies }: SlaOverviewProps) {
  const companyStats = useMemo(() => {
    const stats: CompanyStats[] = [];

    for (const company of companies) {
      const leads = slaData.filter((l) => l.company_id === company.id);
      if (leads.length === 0) continue;

      const zeiten = leads
        .filter((l) => l.first_contact_at != null)
        .map((l) => l.reaktionszeit_minuten);
      const gewonnen = leads.filter((l) => l.status === "gewonnen").length;
      const abgeschlossen = leads.filter(
        (l) => l.status === "gewonnen" || l.status === "verloren"
      ).length;
      const ueber24h = leads.filter(
        (l) =>
          l.first_contact_at === null && l.reaktionszeit_minuten > 24 * 60
      ).length;

      stats.push({
        companyId: company.id,
        companyName: company.name,
        totalLeads: leads.length,
        avgReaktionszeit:
          zeiten.length > 0
            ? zeiten.reduce((a, b) => a + b, 0) / zeiten.length
            : 0,
        medianReaktionszeit: median(zeiten),
        unter15Min: zeiten.filter((z) => z < 15).length,
        unter15MinAnteil:
          zeiten.length > 0
            ? (zeiten.filter((z) => z < 15).length / zeiten.length) * 100
            : 0,
        ueber24hUnbearbeitet: ueber24h,
        abschlussquote:
          abgeschlossen > 0 ? (gewonnen / abgeschlossen) * 100 : 0,
      });
    }

    return stats.sort((a, b) => a.avgReaktionszeit - b.avgReaktionszeit);
  }, [slaData, companies]);

  // Globale Korrelation
  const buckets = useMemo(() => {
    const contacted = slaData.filter((l) => l.first_contact_at != null);
    const groups = [
      { label: "< 5 Min.", min: 0, max: 5, leads: [] as LeadSla[] },
      { label: "5–15 Min.", min: 5, max: 15, leads: [] as LeadSla[] },
      { label: "15–60 Min.", min: 15, max: 60, leads: [] as LeadSla[] },
      { label: "> 60 Min.", min: 60, max: Infinity, leads: [] as LeadSla[] },
    ];

    for (const lead of contacted) {
      const bucket = groups.find(
        (g) =>
          lead.reaktionszeit_minuten >= g.min &&
          lead.reaktionszeit_minuten < g.max
      );
      bucket?.leads.push(lead);
    }

    return groups.map((g) => {
      const gewonnen = g.leads.filter((l) => l.status === "gewonnen").length;
      const abgeschlossen = g.leads.filter(
        (l) => l.status === "gewonnen" || l.status === "verloren"
      ).length;
      return {
        ...g,
        count: g.leads.length,
        abschlussquote:
          abgeschlossen > 0 ? (gewonnen / abgeschlossen) * 100 : 0,
      };
    });
  }, [slaData]);

  // Globale KPIs
  const globalStats = useMemo(() => {
    const alleZeiten = slaData
      .filter((l) => l.first_contact_at != null)
      .map((l) => l.reaktionszeit_minuten);
    const avg =
      alleZeiten.length > 0
        ? alleZeiten.reduce((a, b) => a + b, 0) / alleZeiten.length
        : 0;
    const unter15 = alleZeiten.filter((z) => z < 15).length;

    return {
      totalLeads: slaData.length,
      avgMinuten: avg,
      medianMinuten: median(alleZeiten),
      unter15Anteil:
        alleZeiten.length > 0 ? (unter15 / alleZeiten.length) * 100 : 0,
    };
  }, [slaData]);

  function formatMinuten(min: number): string {
    if (min < 60) return `${Math.round(min)} Min.`;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h}h ${m}m`;
  }

  function getAmpelForMinuten(min: number): SlaAmpel {
    if (min < 15) return "gruen";
    if (min < 60) return "gelb";
    return "rot";
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reaktionszeiten</h1>
        <p className="text-sm text-muted-foreground">
          SLA-Übersicht und Korrelation mit Abschlussquoten
        </p>
      </div>

      {/* Globale KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Leads gesamt</p>
          <p className="mt-1 text-2xl font-bold font-mono">
            {globalStats.totalLeads}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Ø Reaktionszeit</p>
          <p
            className={cn(
              "mt-1 text-2xl font-bold font-mono",
              AMPEL_STYLES[getAmpelForMinuten(globalStats.avgMinuten)]
            )}
          >
            {formatMinuten(globalStats.avgMinuten)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Median</p>
          <p
            className={cn(
              "mt-1 text-2xl font-bold font-mono",
              AMPEL_STYLES[getAmpelForMinuten(globalStats.medianMinuten)]
            )}
          >
            {formatMinuten(globalStats.medianMinuten)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Unter 15 Min.</p>
          <p className="mt-1 text-2xl font-bold font-mono">
            {globalStats.unter15Anteil.toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Korrelation: Reaktionszeit vs Abschlussquote */}
      <div>
        <h2 className="text-sm font-medium mb-3">
          Korrelation: Reaktionszeit → Abschlussquote
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {buckets.map((bucket) => (
            <div
              key={bucket.label}
              className={cn(
                "rounded-lg border p-4",
                AMPEL_BG[
                  getAmpelForMinuten(
                    bucket.min === 0 ? 0 : bucket.min
                  )
                ]
              )}
            >
              <p className="text-xs font-medium">{bucket.label}</p>
              <p className="mt-1 text-2xl font-bold font-mono">
                {bucket.abschlussquote.toFixed(0)}%
              </p>
              <p className="text-xs text-muted-foreground">
                {bucket.count} Leads
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Kunden-Tabelle */}
      <div>
        <h2 className="text-sm font-medium mb-3">Pro Kunde</h2>
        {companyStats.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Noch keine Lead-Daten vorhanden.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Kunde
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    Leads
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    Ø Reaktion
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    Median
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    &lt; 15 Min.
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    &gt; 24h offen
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    Abschluss
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {companyStats.map((stat) => {
                  const avgAmpel = getAmpelForMinuten(stat.avgReaktionszeit);
                  return (
                    <tr key={stat.companyId} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">
                        {stat.companyName}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {stat.totalLeads}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-mono font-medium",
                          AMPEL_STYLES[avgAmpel]
                        )}
                      >
                        {formatMinuten(stat.avgReaktionszeit)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatMinuten(stat.medianReaktionszeit)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {stat.unter15MinAnteil.toFixed(0)}%
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-mono",
                          stat.ueber24hUnbearbeitet > 0 && "text-sla-rot font-medium"
                        )}
                      >
                        {stat.ueber24hUnbearbeitet}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {stat.abschlussquote.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
