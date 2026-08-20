"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatEuro,
  formatPercent,
  formatSeconds,
  formatDays,
  categorizeCancelReason,
  TAGE_KURZ,
  type SalesKpis,
  type PersonStats,
  type CalendlyStats,
  type FunnelStep,
} from "@/lib/sales-utils";

interface CloseUser {
  close_id: string;
  name: string;
  email: string;
  rolle: string;
}

interface CloseLead {
  close_id: string;
  status_type: string;
  date_created: string;
}

interface CloseOpp {
  close_id: string;
  lead_id: string;
  value: number;
  status_type: string;
  user_id: string;
  date_won: string | null;
  date_created: string;
}

interface CloseActivity {
  close_id: string;
  lead_id: string;
  type: string;
  direction: string | null;
  duration: number | null;
  user_id: string;
  date_created: string;
  disposition: string | null;
}

interface CalendlyEvent {
  calendly_uri: string;
  event_type_name: string | null;
  status: string;
  no_show: boolean;
  canceled_by: string | null;
  cancel_reason: string | null;
  scheduled_at: string;
  host_email: string | null;
  invitee_name: string | null;
}

interface CustomActivity {
  close_id: string;
  custom_activity_type_name: string | null;
  user_id: string | null;
  date_created: string | null;
}

interface PrevPeriod {
  leads: number;
  closes: number;
  umsatz: number;
  termineWahrgenommen: number;
  metaSpend: number;
}

interface SalesDashboardProps {
  users: CloseUser[];
  leads: CloseLead[];
  opportunities: CloseOpp[];
  activities: CloseActivity[];
  calendlyEvents: CalendlyEvent[];
  customActivities: CustomActivity[];
  metaSpend?: number;
  prevPeriod?: PrevPeriod;
}

export function SalesDashboard({
  users,
  leads,
  opportunities,
  activities,
  calendlyEvents,
  customActivities,
  metaSpend = 0,
  prevPeriod,
}: SalesDashboardProps) {
  // Gesprächsprotokolle (Custom Activity "Gesprächsprotokoll 1 Cold Call")
  const gespraechsprotokolle = customActivities.filter((ca) =>
    ca.custom_activity_type_name?.toLowerCase().includes("gesprächsprotokoll") ||
    ca.custom_activity_type_name?.toLowerCase().includes("gesprachsprotokoll") ||
    ca.custom_activity_type_name?.toLowerCase().includes("cold call")
  );

  // Calendly: Erstgespräch vs Beratungsgespräch
  const erstgespraeche = calendlyEvents.filter((e) =>
    e.event_type_name?.toLowerCase().includes("erstgespräch") ||
    e.event_type_name?.toLowerCase().includes("erstgespraech")
  );
  const beratungsgespraeche = calendlyEvents.filter((e) =>
    e.event_type_name?.toLowerCase().includes("beratungsgespräch") ||
    e.event_type_name?.toLowerCase().includes("beratungsgespraech")
  );

  const erstShowsCount = erstgespraeche.filter((e) => e.status === "active" && !e.no_show).length;
  const erstAbgesagtCount = erstgespraeche.filter((e) => e.status === "canceled").length;
  const erstNoShowCount = erstgespraeche.filter((e) => e.no_show).length;

  const beratungShowsCount = beratungsgespraeche.filter((e) => e.status === "active" && !e.no_show).length;
  const beratungAbgesagtCount = beratungsgespraeche.filter((e) => e.status === "canceled").length;
  const beratungNoShowCount = beratungsgespraeche.filter((e) => e.no_show).length;
  // ========== KPIs ==========
  const kpis = useMemo((): SalesKpis => {
    const calls = activities.filter((a) => a.type === "call");
    const gespraeche = calls.filter((a) => a.duration && a.duration > 30).length;
    const termineGebucht = calendlyEvents.length;
    const termineAbgesagt = calendlyEvents.filter((e) => e.status === "canceled").length;
    const noShows = calendlyEvents.filter((e) => e.no_show).length;
    const termineWahrgenommen = calendlyEvents.filter(
      (e) => e.status === "active" && !e.no_show
    ).length;
    const showRate = termineGebucht > 0 ? (termineWahrgenommen / termineGebucht) * 100 : 0;
    const noShowRate = termineGebucht > 0 ? (noShows / termineGebucht) * 100 : 0;
    const absageRate = termineGebucht > 0 ? (termineAbgesagt / termineGebucht) * 100 : 0;

    const wonOpps = opportunities.filter((o) => o.status_type === "won");
    const activeOpps = opportunities.filter((o) => o.status_type === "active");
    const umsatz = wonOpps.reduce((s, o) => s + (o.value ?? 0), 0);
    const closingRate = termineWahrgenommen > 0 ? (wonOpps.length / termineWahrgenommen) * 100 : 0;
    const closingsProTermin = termineWahrgenommen > 0 ? wonOpps.length / termineWahrgenommen : 0;
    const costPerClosingCall = termineWahrgenommen > 0 ? metaSpend / termineWahrgenommen : 0;
    const costPerClose = wonOpps.length > 0 ? metaSpend / wonOpps.length : 0;
    const revenuePerLead = leads.length > 0 ? umsatz / leads.length : 0;

    return {
      leadsNeu: leads.length,
      gespraeche,
      termineGebucht,
      termineWahrgenommen,
      termineAbgesagt,
      noShows,
      showRate,
      noShowRate,
      absageRate,
      angebote: activeOpps.length + wonOpps.length,
      closes: wonOpps.length,
      closingsProTermin,
      umsatz,
      avgDealgroesse: wonOpps.length > 0 ? umsatz / wonOpps.length : 0,
      closingRate,
      costPerClosingCall,
      costPerClose,
      revenuePerLead,
    };
  }, [leads, opportunities, activities, calendlyEvents, metaSpend]);

  // ========== Funnel ==========
  const funnel = useMemo((): FunnelStep[] => [
    { label: "Leads", count: kpis.leadsNeu, conversionFromPrev: null },
    { label: "Gespräche", count: kpis.gespraeche, conversionFromPrev: kpis.leadsNeu > 0 ? (kpis.gespraeche / kpis.leadsNeu) * 100 : 0 },
    { label: "Termine", count: kpis.termineGebucht, conversionFromPrev: kpis.gespraeche > 0 ? (kpis.termineGebucht / kpis.gespraeche) * 100 : 0 },
    { label: "Shows", count: kpis.termineWahrgenommen, conversionFromPrev: kpis.showRate },
    { label: "Angebote", count: kpis.angebote, conversionFromPrev: kpis.termineWahrgenommen > 0 ? (kpis.angebote / kpis.termineWahrgenommen) * 100 : 0 },
    { label: "Closes", count: kpis.closes, conversionFromPrev: kpis.angebote > 0 ? (kpis.closes / kpis.angebote) * 100 : 0 },
  ], [kpis]);

  // ========== Person-Stats ==========
  const personStats = useMemo((): PersonStats[] => {
    return users.map((user) => {
      const userActs = activities.filter((a) => a.user_id === user.close_id);
      const calls = userActs.filter((a) => a.type === "call");
      const erreicht = calls.filter((a) => a.duration && a.duration > 30);
      const durations = erreicht.map((a) => a.duration ?? 0).filter((d) => d > 0);
      const avgDauer = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
      const gesamtDauer = durations.reduce((s, d) => s + d, 0);

      // Calendly: Termine über host_email matchen
      const userCalendly = calendlyEvents.filter((e) => e.host_email === user.email);
      const termineGesetzt = userCalendly.length;
      const showsEigen = userCalendly.filter((e) => e.status === "active" && !e.no_show).length;
      const showRateEigen = termineGesetzt > 0 ? (showsEigen / termineGesetzt) * 100 : 0;

      const userOpps = opportunities.filter((o) => o.user_id === user.close_id);
      const wonOpps = userOpps.filter((o) => o.status_type === "won");
      const umsatz = wonOpps.reduce((s, o) => s + (o.value ?? 0), 0);

      // Ø Zeit bis Close (Tage zwischen Opp-Erstellung und date_won)
      const closeTimeDays = wonOpps
        .filter((o) => o.date_won && o.date_created)
        .map((o) => {
          const created = new Date(o.date_created).getTime();
          const won = new Date(o.date_won!).getTime();
          return (won - created) / (1000 * 60 * 60 * 24);
        });
      const avgZeitBisClose = closeTimeDays.length > 0
        ? closeTimeDays.reduce((s, d) => s + d, 0) / closeTimeDays.length
        : 0;

      const termineWahrgenommen = user.rolle === "closer"
        ? userCalendly.filter((e) => e.status === "active" && !e.no_show).length
        : showsEigen;

      return {
        closeId: user.close_id,
        name: user.name,
        email: user.email,
        rolle: user.rolle,
        anrufeGesamt: calls.length,
        anrufeErreicht: erreicht.length,
        gespraechsquote: calls.length > 0 ? (erreicht.length / calls.length) * 100 : 0,
        avgGespraechsdauer: avgDauer,
        gespraechszeitGesamt: gesamtDauer,
        termineGesetzt,
        termineProHundert: calls.length > 0 ? (termineGesetzt / calls.length) * 100 : 0,
        showRateEigen,
        closesAusEigenen: wonOpps.length,
        umsatzAusEigenen: umsatz,
        termineWahrgenommen,
        angebote: userOpps.filter((o) => o.status_type === "active").length + wonOpps.length,
        closes: wonOpps.length,
        closingRate: termineWahrgenommen > 0 ? (wonOpps.length / termineWahrgenommen) * 100 : 0,
        umsatz,
        avgDealgroesse: wonOpps.length > 0 ? umsatz / wonOpps.length : 0,
        avgZeitBisClose,
        costPerClosingCall: termineWahrgenommen > 0 ? metaSpend / termineWahrgenommen : 0,
      };
    });
  }, [users, activities, opportunities, calendlyEvents, metaSpend]);

  const openerSetterStats = personStats.filter((p) => p.rolle === "opener" || p.rolle === "setter");
  const closerStats = personStats.filter((p) => p.rolle === "closer");

  // ========== Calendly Stats ==========
  const calendlyStats = useMemo((): CalendlyStats => {
    const gesamt = calendlyEvents.length;
    const abgesagt = calendlyEvents.filter((e) => e.status === "canceled");
    const noShows = calendlyEvents.filter((e) => e.no_show);
    const stattgefunden = calendlyEvents.filter((e) => e.status === "active" && !e.no_show);

    const gruende = new Map<string, number>();
    for (const e of abgesagt) {
      const cat = categorizeCancelReason(e.cancel_reason);
      gruende.set(cat, (gruende.get(cat) ?? 0) + 1);
    }

    const now = Date.now();
    let ueber24h = 0, unter24h = 0, unter2h = 0;
    for (const e of abgesagt) {
      const vorlauf = new Date(e.scheduled_at).getTime() - now;
      if (vorlauf > 24 * 3600000) ueber24h++;
      else if (vorlauf > 2 * 3600000) unter24h++;
      else unter2h++;
    }

    // Slot-Heatmap: Wochentag × Stunde
    const slotMap = new Map<string, number>();
    for (const e of calendlyEvents) {
      if (e.status !== "active" || e.no_show) continue;
      const d = new Date(e.scheduled_at);
      const tag = (d.getDay() + 6) % 7; // Mo=0
      const stunde = d.getHours();
      const key = `${tag}-${stunde}`;
      slotMap.set(key, (slotMap.get(key) ?? 0) + 1);
    }
    const slotHeatmap = Array.from(slotMap.entries()).map(([key, count]) => {
      const [tag, stunde] = key.split("-").map(Number);
      return { tag, stunde, count };
    });

    return {
      gesamt,
      stattgefunden: stattgefunden.length,
      abgesagt: abgesagt.length,
      noShow: noShows.length,
      absageQuote: gesamt > 0 ? (abgesagt.length / gesamt) * 100 : 0,
      noShowRate: gesamt > 0 ? (noShows.length / gesamt) * 100 : 0,
      absagegruende: Array.from(gruende.entries())
        .map(([grund, anzahl]) => ({ grund, anzahl }))
        .sort((a, b) => b.anzahl - a.anzahl),
      absagenNachVorlauf: { ueber24h, unter24h, unter2h },
      absagenNachPartei: {
        invitee: abgesagt.filter((e) => e.canceled_by === "invitee").length,
        host: abgesagt.filter((e) => e.canceled_by === "host").length,
      },
      slotHeatmap,
    };
  }, [calendlyEvents]);

  // ========== Aktivitäts-Heatmap ==========
  const activityHeatmap = useMemo(() => {
    const map = new Map<string, number>();
    const calls = activities.filter((a) => a.type === "call");
    for (const c of calls) {
      const d = new Date(c.date_created);
      const tag = (d.getDay() + 6) % 7;
      const stunde = d.getHours();
      const key = `${tag}-${stunde}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [activities]);

  const hasData = leads.length > 0 || activities.length > 0 || calendlyEvents.length > 0;

  // Heatmap-Renderer
  function renderHeatmap(data: Map<string, number> | { tag: number; stunde: number; count: number }[], label: string) {
    const dataMap = data instanceof Map ? data : new Map(data.map((d) => [`${d.tag}-${d.stunde}`, d.count]));
    const maxVal = Math.max(...Array.from(dataMap.values()), 1);
    const stunden = Array.from({ length: 12 }, (_, i) => i + 8); // 8-19 Uhr

    return (
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-xs font-medium mb-3">{label}</h3>
        <div className="overflow-x-auto">
          <div className="grid gap-px" style={{ gridTemplateColumns: `2rem repeat(${stunden.length}, 1fr)` }}>
            {/* Header */}
            <div />
            {stunden.map((h) => (
              <div key={h} className="text-center text-[9px] text-muted-foreground pb-1">
                {h}
              </div>
            ))}
            {/* Rows */}
            {TAGE_KURZ.map((tag, tagIdx) => (
              <>
                <div key={`label-${tagIdx}`} className="text-[10px] text-muted-foreground flex items-center pr-1">
                  {tag}
                </div>
                {stunden.map((stunde) => {
                  const val = dataMap.get(`${tagIdx}-${stunde}`) ?? 0;
                  const intensity = val > 0 ? Math.max(0.15, val / maxVal) : 0;
                  return (
                    <div
                      key={`${tagIdx}-${stunde}`}
                      className="aspect-square rounded-sm"
                      style={{
                        backgroundColor: val > 0 ? `oklch(0.55 0.16 155 / ${intensity})` : "var(--muted)",
                      }}
                      title={`${tag} ${stunde}:00 — ${val}`}
                    />
                  );
                })}
              </>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Delta helper
  function delta(current: number, prev: number | undefined): string | null {
    if (prev === undefined || prev === 0) return null;
    const pct = ((current - prev) / prev) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  }

  return (
    <div className="space-y-6">
      {!hasData ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
          <p className="text-sm font-medium">Noch keine Sync-Daten</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Daten werden nach Anbindung von Close und Calendly automatisch synchronisiert.
          </p>
        </div>
      ) : (
        <>
          {/* ===== KPI-Zeile ===== */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {([
              { label: "Leads", value: kpis.leadsNeu.toString(), d: delta(kpis.leadsNeu, prevPeriod?.leads) },
              { label: "Gespräche", value: kpis.gespraeche.toString() },
              { label: "Termine gebucht", value: kpis.termineGebucht.toString() },
              { label: "Termine wahrgen.", value: kpis.termineWahrgenommen.toString(), d: delta(kpis.termineWahrgenommen, prevPeriod?.termineWahrgenommen) },
              { label: "Show-Rate", value: formatPercent(kpis.showRate) },
              { label: "No-Show-Rate", value: formatPercent(kpis.noShowRate), warn: kpis.noShowRate > 15 },
              { label: "Absage-Rate", value: formatPercent(kpis.absageRate) },
              { label: "No-Shows", value: kpis.noShows.toString(), warn: kpis.noShows > 0 },
              { label: "Angebote", value: kpis.angebote.toString() },
              { label: "Closes", value: kpis.closes.toString(), d: delta(kpis.closes, prevPeriod?.closes) },
              { label: "Closings / Termin", value: kpis.closingsProTermin.toFixed(2) },
              { label: "Closing-Rate", value: formatPercent(kpis.closingRate) },
              { label: "Umsatz", value: formatEuro(kpis.umsatz), d: delta(kpis.umsatz, prevPeriod?.umsatz) },
              { label: "Ø Dealgröße", value: formatEuro(kpis.avgDealgroesse) },
              { label: "Cost / Closing Call", value: formatEuro(kpis.costPerClosingCall) },
              { label: "Cost / Close (CAC)", value: formatEuro(kpis.costPerClose) },
              { label: "Revenue / Lead", value: formatEuro(kpis.revenuePerLead) },
              { label: "Gesprächsprotokolle", value: gespraechsprotokolle.length.toString() },
              { label: "Erstgespräche (Setting)", value: `${erstgespraeche.length} (${erstShowsCount} Shows)` },
              { label: "Beratungsgespräche", value: `${beratungsgespraeche.length} (${beratungShowsCount} Shows)` },
              { label: "Absagen Erstgespr.", value: erstAbgesagtCount.toString(), warn: erstAbgesagtCount > 0 },
              { label: "Absagen Beratung", value: beratungAbgesagtCount.toString(), warn: beratungAbgesagtCount > 0 },
              { label: "No-Shows Erstgespr.", value: erstNoShowCount.toString(), warn: erstNoShowCount > 0 },
              { label: "No-Shows Beratung", value: beratungNoShowCount.toString(), warn: beratungNoShowCount > 0 },
              { label: "Show-Rate Erstgespr.", value: erstgespraeche.length > 0 ? formatPercent((erstShowsCount / erstgespraeche.length) * 100) : "—" },
              { label: "Show-Rate Beratung", value: beratungsgespraeche.length > 0 ? formatPercent((beratungShowsCount / beratungsgespraeche.length) * 100) : "—" },
            ] as { label: string; value: string; warn?: boolean; d?: string | null }[]).map((kpi) => (
              <div key={kpi.label} className="rounded-lg border bg-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
                <div className="flex items-baseline gap-1.5">
                  <p className={cn("mt-0.5 text-xl font-bold font-mono", kpi.warn && "text-sla-rot")}>{kpi.value}</p>
                  {kpi.d && (
                    <span className={cn(
                      "text-[10px] font-mono font-medium",
                      kpi.d.startsWith("+") ? "text-success" : "text-sla-rot"
                    )}>
                      {kpi.d}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ===== Funnel ===== */}
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium mb-3">Funnel</h2>
            <div className="flex items-end gap-2 overflow-x-auto pb-2">
              {funnel.map((step, i) => {
                const maxCount = Math.max(...funnel.map((s) => s.count), 1);
                const heightPct = (step.count / maxCount) * 100;
                return (
                  <div key={step.label} className="flex flex-1 min-w-16 flex-col items-center gap-1">
                    {step.conversionFromPrev !== null && i > 0 && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {formatPercent(step.conversionFromPrev)}
                      </span>
                    )}
                    <div
                      className="w-full rounded-t bg-primary/80 transition-all min-h-2"
                      style={{ height: `${Math.max(heightPct, 4)}px`, maxHeight: "120px" }}
                    />
                    <span className="text-lg font-bold font-mono">{step.count}</span>
                    <span className="text-[10px] text-muted-foreground text-center">{step.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ===== Tabs ===== */}
          <Tabs defaultValue="opener">
            <TabsList>
              <TabsTrigger value="opener">Opener / Setter</TabsTrigger>
              <TabsTrigger value="closer">Closer</TabsTrigger>
              <TabsTrigger value="calendly">Calendly</TabsTrigger>
              <TabsTrigger value="heatmaps">Heatmaps</TabsTrigger>
            </TabsList>

            {/* ===== Opener/Setter ===== */}
            <TabsContent value="opener" className="mt-4">
              {openerSetterStats.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Keine Opener/Setter in Close konfiguriert.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        {["Name", "Anrufe", "Erreicht", "Quote", "Ø Dauer", "Gesamtzeit", "Protokolle", "Termine", "T/100 Calls", "Show-Rate", "Closes", "Umsatz"].map((h) => (
                          <th key={h} className={cn("px-3 py-2 text-xs font-medium text-muted-foreground", h === "Name" ? "text-left" : "text-right")}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {openerSetterStats.map((p) => (
                        <tr key={p.closeId} className="hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">
                            {p.name}
                            <span className="ml-1.5 text-[10px] text-muted-foreground">{p.rolle}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{p.anrufeGesamt}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.anrufeErreicht}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatPercent(p.gespraechsquote)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatSeconds(p.avgGespraechsdauer)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatSeconds(p.gespraechszeitGesamt)}</td>
                          <td className="px-3 py-2 text-right font-mono">{gespraechsprotokolle.filter((g) => g.user_id === p.closeId).length}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.termineGesetzt}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatPercent(p.termineProHundert)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatPercent(p.showRateEigen)}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.closesAusEigenen}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatEuro(p.umsatzAusEigenen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* ===== Closer ===== */}
            <TabsContent value="closer" className="mt-4">
              {closerStats.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Keine Closer in Close konfiguriert.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        {["Name", "Termine", "Angebote", "Closes", "Closing-Rate", "Closings/Termin", "Umsatz", "Ø Deal", "Ø Tage bis Close", "Cost/Call"].map((h) => (
                          <th key={h} className={cn("px-3 py-2 text-xs font-medium text-muted-foreground", h === "Name" ? "text-left" : "text-right")}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {closerStats.map((p) => (
                        <tr key={p.closeId} className="hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{p.name}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.termineWahrgenommen}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.angebote}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.closes}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatPercent(p.closingRate)}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {p.termineWahrgenommen > 0 ? (p.closes / p.termineWahrgenommen).toFixed(2) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{formatEuro(p.umsatz)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatEuro(p.avgDealgroesse)}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.avgZeitBisClose > 0 ? formatDays(p.avgZeitBisClose) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatEuro(p.costPerClosingCall)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* ===== Calendly ===== */}
            <TabsContent value="calendly" className="mt-4 space-y-4">
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { label: "Termine", value: calendlyStats.gesamt.toString() },
                  { label: "Stattgefunden", value: calendlyStats.stattgefunden.toString() },
                  { label: "Abgesagt", value: calendlyStats.abgesagt.toString() },
                  { label: "No-Shows", value: calendlyStats.noShow.toString(), warn: calendlyStats.noShow > 0 },
                  { label: "Absagequote", value: formatPercent(calendlyStats.absageQuote) },
                  { label: "No-Show-Rate", value: formatPercent(calendlyStats.noShowRate), warn: calendlyStats.noShowRate > 15 },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-lg border bg-card p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
                    <p className={cn("mt-0.5 text-xl font-bold font-mono", "warn" in kpi && kpi.warn && "text-sla-rot")}>{kpi.value}</p>
                  </div>
                ))}
              </div>

              {calendlyStats.absagegruende.length > 0 && (
                <div className="rounded-lg border bg-card p-4">
                  <h3 className="text-xs font-medium mb-2">Absagegründe</h3>
                  <div className="space-y-1.5">
                    {calendlyStats.absagegruende.map((g) => {
                      const pct = calendlyStats.abgesagt > 0 ? (g.anzahl / calendlyStats.abgesagt) * 100 : 0;
                      return (
                        <div key={g.grund} className="flex items-center gap-3 text-sm">
                          <span className="flex-1">{g.grund}</span>
                          <div className="w-24 h-1.5 rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="font-mono text-muted-foreground w-8 text-right">{g.anzahl}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-card p-4">
                  <h3 className="text-xs font-medium mb-2">Absagen nach Vorlaufzeit</h3>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span>&gt; 24 Stunden</span>
                      <span className="font-mono">{calendlyStats.absagenNachVorlauf.ueber24h}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>2–24 Stunden</span>
                      <span className="font-mono">{calendlyStats.absagenNachVorlauf.unter24h}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>&lt; 2 Stunden</span>
                      <span className="font-mono text-sla-rot font-medium">{calendlyStats.absagenNachVorlauf.unter2h}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <h3 className="text-xs font-medium mb-2">Wer hat abgesagt?</h3>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span>Eingeladener</span>
                      <span className="font-mono">{calendlyStats.absagenNachPartei.invitee}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Host</span>
                      <span className="font-mono">{calendlyStats.absagenNachPartei.host}</span>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ===== Heatmaps ===== */}
            <TabsContent value="heatmaps" className="mt-4 space-y-4">
              {renderHeatmap(activityHeatmap, "Anrufe pro Tag / Stunde (90 Tage)")}
              {renderHeatmap(calendlyStats.slotHeatmap, "Termine-Slots: Wann halten Termine am besten?")}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
