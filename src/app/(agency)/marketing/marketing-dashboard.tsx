"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatEuro, formatPercent } from "@/lib/sales-utils";

interface MetaInsight {
  date: string;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  leads: number;
  cost_per_lead: number;
}

interface GoogleInsight {
  date: string;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cost_per_lead: number;
  company_id: string;
  companies: { name: string } | null;
}

interface WonOpp {
  value: number;
  status_type: string;
  lead_id: string;
}

interface CalendlyEvent {
  event_type_name: string | null;
  status: string;
  no_show: boolean;
}

interface MarketingDashboardProps {
  metaInsights: MetaInsight[];
  googleInsights: GoogleInsight[];
  wonOpportunities: WonOpp[];
  calendlyEvents: CalendlyEvent[];
}

export function MarketingDashboard({
  metaInsights,
  googleInsights,
  wonOpportunities,
  calendlyEvents,
}: MarketingDashboardProps) {
  const meta = useMemo(() => {
    const spend = metaInsights.reduce((s, r) => s + Number(r.spend), 0);
    const impressions = metaInsights.reduce((s, r) => s + r.impressions, 0);
    const clicks = metaInsights.reduce((s, r) => s + r.clicks, 0);
    const leads = metaInsights.reduce((s, r) => s + r.leads, 0);
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpl = leads > 0 ? spend / leads : 0;

    // Calendly Termine
    const settings = calendlyEvents.filter((e) =>
      e.event_type_name?.toLowerCase().includes("erstgespräch") ||
      e.event_type_name?.toLowerCase().includes("erstgespraech")
    );
    const settingShows = settings.filter((e) => e.status === "active" && !e.no_show).length;

    const closings = calendlyEvents.filter((e) =>
      e.event_type_name?.toLowerCase().includes("strategiegespräch") ||
      e.event_type_name?.toLowerCase().includes("strategiegespraech")
    );
    const closingShows = closings.filter((e) => e.status === "active" && !e.no_show).length;

    const onboardings = calendlyEvents.filter((e) =>
      e.event_type_name?.toLowerCase().includes("onboarding")
    );
    const onboardingShows = onboardings.filter((e) => e.status === "active" && !e.no_show).length;

    // Close Umsatz
    const wonUmsatz = wonOpportunities.reduce((s, o) => s + Number(o.value), 0);
    const wonCount = wonOpportunities.length;

    // Kosten-KPIs
    const costPerSetting = settingShows > 0 ? spend / settingShows : 0;
    const costPerClosing = closingShows > 0 ? spend / closingShows : 0;
    const costPerOnboarding = onboardingShows > 0 ? spend / onboardingShows : 0;
    const cac = wonCount > 0 ? spend / wonCount : 0;
    const roas = spend > 0 ? wonUmsatz / spend : 0;

    return {
      spend, impressions, clicks, leads, ctr, cpc, cpl,
      settingShows, closingShows, onboardingShows, wonCount, wonUmsatz,
      costPerSetting, costPerClosing, costPerOnboarding, cac, roas,
    };
  }, [metaInsights, wonOpportunities, calendlyEvents]);

  // Kampagnen-Tabelle
  const campaigns = useMemo(() => {
    const map = new Map<string, { spend: number; impressions: number; clicks: number; leads: number }>();
    for (const r of metaInsights) {
      const key = r.campaign_name ?? "Unbekannt";
      const prev = map.get(key) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0 };
      map.set(key, {
        spend: prev.spend + Number(r.spend),
        impressions: prev.impressions + r.impressions,
        clicks: prev.clicks + r.clicks,
        leads: prev.leads + r.leads,
      });
    }
    return Array.from(map.entries())
      .map(([name, stats]) => ({
        name,
        ...stats,
        cpl: stats.leads > 0 ? stats.spend / stats.leads : 0,
        ctr: stats.impressions > 0 ? (stats.clicks / stats.impressions) * 100 : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [metaInsights]);

  // Google Ads pro Kunde
  const googleByCompany = useMemo(() => {
    const map = new Map<string, { companyName: string; spend: number; leads: number; clicks: number }>();
    for (const r of googleInsights) {
      const key = r.company_id;
      const prev = map.get(key) ?? { companyName: r.companies?.name ?? "Unbekannt", spend: 0, leads: 0, clicks: 0 };
      map.set(key, {
        companyName: prev.companyName,
        spend: prev.spend + Number(r.spend),
        leads: prev.leads + r.leads,
        clicks: prev.clicks + r.clicks,
      });
    }
    return Array.from(map.values())
      .map((c) => ({ ...c, cpl: c.leads > 0 ? c.spend / c.leads : 0 }))
      .sort((a, b) => b.spend - a.spend);
  }, [googleInsights]);

  const hasData = metaInsights.length > 0 || googleInsights.length > 0;

  return (
    <div className="space-y-6">
      {!hasData ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
          <p className="text-sm font-medium">Noch keine Ad-Daten</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Daten werden nach Anbindung der Werbekonten synchronisiert.
          </p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {([
              { label: "Ad Spend", value: formatEuro(meta.spend) },
              { label: "Impressions", value: meta.impressions.toLocaleString("de-DE") },
              { label: "Klicks", value: meta.clicks.toLocaleString("de-DE") },
              { label: "CTR", value: formatPercent(meta.ctr) },
              { label: "CPC", value: formatEuro(meta.cpc) },
              { label: "Leads (Meta)", value: meta.leads.toString() },
              { label: "CPL", value: formatEuro(meta.cpl) },
              { label: "Settings (Shows)", value: meta.settingShows.toString() },
              { label: "Cost / Setting", value: formatEuro(meta.costPerSetting) },
              { label: "Closings (Shows)", value: meta.closingShows.toString() },
              { label: "Cost / Closing", value: formatEuro(meta.costPerClosing) },
              { label: "Onboardings", value: meta.onboardingShows.toString() },
              { label: "Cost / Onboarding", value: formatEuro(meta.costPerOnboarding) },
              { label: "Won Deals", value: meta.wonCount.toString() },
              { label: "Umsatz", value: formatEuro(meta.wonUmsatz) },
              { label: "CAC", value: formatEuro(meta.cac) },
              { label: "ROAS", value: meta.roas > 0 ? `${meta.roas.toFixed(2)}x` : "—" },
            ] as { label: string; value: string }[])
              .filter((k) => k.value !== "0" && k.value !== "0 €" && k.value !== "0,0%" && k.value !== "—")
              .map((kpi) => (
                <div key={kpi.label} className="rounded-lg border bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
                  <p className="mt-0.5 text-xl font-bold font-mono">{kpi.value}</p>
                </div>
              ))}
          </div>

          {/* Kampagnen-Tabelle */}
          {campaigns.length > 0 && (
            <div>
              <h2 className="text-sm font-medium mb-3">Kampagnen</h2>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {["Kampagne", "Spend", "Impressions", "Klicks", "CTR", "Leads", "CPL"].map((h) => (
                        <th key={h} className={cn("px-3 py-2 text-xs font-medium text-muted-foreground", h === "Kampagne" ? "text-left" : "text-right")}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {campaigns.map((c) => (
                      <tr key={c.name} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium max-w-48 truncate">{c.name}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatEuro(c.spend)}</td>
                        <td className="px-3 py-2 text-right font-mono">{c.impressions.toLocaleString("de-DE")}</td>
                        <td className="px-3 py-2 text-right font-mono">{c.clicks}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatPercent(c.ctr)}</td>
                        <td className="px-3 py-2 text-right font-mono">{c.leads}</td>
                        <td className="px-3 py-2 text-right font-mono">{c.leads > 0 ? formatEuro(c.cpl) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Google Ads pro Kunde */}
          {googleByCompany.length > 0 && (
            <div>
              <h2 className="text-sm font-medium mb-3">Google Ads (Kunden)</h2>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {["Kunde", "Spend", "Klicks", "Leads", "CPL"].map((h) => (
                        <th key={h} className={cn("px-3 py-2 text-xs font-medium text-muted-foreground", h === "Kunde" ? "text-left" : "text-right")}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {googleByCompany.map((c) => (
                      <tr key={c.companyName} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">{c.companyName}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatEuro(c.spend)}</td>
                        <td className="px-3 py-2 text-right font-mono">{c.clicks}</td>
                        <td className="px-3 py-2 text-right font-mono">{c.leads}</td>
                        <td className="px-3 py-2 text-right font-mono">{c.leads > 0 ? formatEuro(c.cpl) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
