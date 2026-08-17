"use client";

import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

interface MarketingDashboardProps {
  metaInsights: MetaInsight[];
  googleInsights: GoogleInsight[];
  wonOpportunities: WonOpp[];
}

export function MarketingDashboard({
  metaInsights,
  googleInsights,
  wonOpportunities,
}: MarketingDashboardProps) {
  // Meta KPIs
  const metaKpis = useMemo(() => {
    const spend = metaInsights.reduce((s, r) => s + Number(r.spend), 0);
    const impressions = metaInsights.reduce((s, r) => s + r.impressions, 0);
    const clicks = metaInsights.reduce((s, r) => s + r.clicks, 0);
    const leads = metaInsights.reduce((s, r) => s + r.leads, 0);
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpl = leads > 0 ? spend / leads : 0;

    // ROAS: Close-Umsatz / Meta-Spend
    const wonUmsatz = wonOpportunities.reduce(
      (s, o) => s + Number(o.value),
      0
    );
    const roas = spend > 0 ? wonUmsatz / spend : 0;
    const cac = wonOpportunities.length > 0 ? spend / wonOpportunities.length : 0;

    return { spend, impressions, clicks, leads, ctr, cpc, cpl, roas, cac };
  }, [metaInsights, wonOpportunities]);

  // Meta Kampagnen-Tabelle
  const metaCampaigns = useMemo(() => {
    const map = new Map<
      string,
      { spend: number; impressions: number; clicks: number; leads: number }
    >();
    for (const r of metaInsights) {
      const key = r.campaign_name ?? "Unbekannt";
      const prev = map.get(key) ?? {
        spend: 0,
        impressions: 0,
        clicks: 0,
        leads: 0,
      };
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
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [metaInsights]);

  // Google Ads pro Kunde
  const googleByCompany = useMemo(() => {
    const map = new Map<
      string,
      {
        companyName: string;
        spend: number;
        leads: number;
        clicks: number;
      }
    >();
    for (const r of googleInsights) {
      const key = r.company_id;
      const prev = map.get(key) ?? {
        companyName: r.companies?.name ?? "Unbekannt",
        spend: 0,
        leads: 0,
        clicks: 0,
      };
      map.set(key, {
        companyName: prev.companyName,
        spend: prev.spend + Number(r.spend),
        leads: prev.leads + r.leads,
        clicks: prev.clicks + r.clicks,
      });
    }
    return Array.from(map.values())
      .map((c) => ({
        ...c,
        cpl: c.leads > 0 ? c.spend / c.leads : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [googleInsights]);

  const hasData = metaInsights.length > 0 || googleInsights.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Marketing-Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Letzte 90 Tage — Meta Ads + Google Ads
        </p>
      </div>

      {!hasData ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
          <p className="text-sm font-medium">Noch keine Ad-Daten</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Daten werden nach Anbindung der Werbekonten synchronisiert.
          </p>
        </div>
      ) : (
        <Tabs defaultValue="meta">
          <TabsList>
            <TabsTrigger value="meta">Meta Ads (Hoffman)</TabsTrigger>
            <TabsTrigger value="google">
              Google Ads (Kunden)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="meta" className="mt-4 space-y-4">
            {/* Meta KPIs */}
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { label: "Spend", value: formatEuro(metaKpis.spend) },
                {
                  label: "Impressions",
                  value: metaKpis.impressions.toLocaleString("de-DE"),
                },
                {
                  label: "Klicks",
                  value: metaKpis.clicks.toLocaleString("de-DE"),
                },
                { label: "CTR", value: formatPercent(metaKpis.ctr) },
                { label: "CPC", value: formatEuro(metaKpis.cpc) },
                { label: "Leads", value: metaKpis.leads.toString() },
                { label: "CPL", value: formatEuro(metaKpis.cpl) },
                {
                  label: "ROAS",
                  value: `${metaKpis.roas.toFixed(1)}x`,
                },
                { label: "CAC", value: formatEuro(metaKpis.cac) },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-lg border bg-card p-3"
                >
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {kpi.label}
                  </p>
                  <p className="mt-0.5 text-xl font-bold font-mono">
                    {kpi.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Kampagnen-Tabelle */}
            {metaCampaigns.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                        Kampagne
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                        Spend
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                        Klicks
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                        Leads
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                        CPL
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {metaCampaigns.map((c) => (
                      <tr key={c.name} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">
                          {c.name}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatEuro(c.spend)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {c.clicks}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {c.leads}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatEuro(c.cpl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="google" className="mt-4 space-y-4">
            {googleByCompany.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                Noch keine Google Ads Daten. CSV-Import oder API-Anbindung
                in einer späteren Phase.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                        Kunde
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                        Spend
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                        Klicks
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                        Leads
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                        CPL
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {googleByCompany.map((c) => (
                      <tr
                        key={c.companyName}
                        className="hover:bg-muted/30"
                      >
                        <td className="px-3 py-2 font-medium">
                          {c.companyName}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatEuro(c.spend)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {c.clicks}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {c.leads}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatEuro(c.cpl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
