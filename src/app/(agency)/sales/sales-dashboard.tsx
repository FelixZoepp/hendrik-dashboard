"use client";

import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatEuro,
  formatPercent,
  formatSeconds,
  categorizeCancelReason,
  type SalesKpis,
  type PersonStats,
  type CalendlyStats,
  type FunnelStep,
} from "@/lib/sales-utils";

interface CloseUser {
  close_id: string;
  name: string;
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
  status: string;
  no_show: boolean;
  canceled_by: string | null;
  cancel_reason: string | null;
  scheduled_at: string;
  host_email: string | null;
  invitee_name: string | null;
}

interface SalesDashboardProps {
  users: CloseUser[];
  leads: CloseLead[];
  opportunities: CloseOpp[];
  activities: CloseActivity[];
  calendlyEvents: CalendlyEvent[];
}

export function SalesDashboard({
  users,
  leads,
  opportunities,
  activities,
  calendlyEvents,
}: SalesDashboardProps) {
  // KPIs berechnen
  const kpis = useMemo((): SalesKpis => {
    const calls = activities.filter((a) => a.type === "call");
    const gespraeche = calls.filter(
      (a) => a.duration && a.duration > 30
    ).length;
    const termineGebucht = calendlyEvents.length;
    const termineWahrgenommen = calendlyEvents.filter(
      (e) => e.status === "active" && !e.no_show
    ).length;
    const showRate =
      termineGebucht > 0
        ? (termineWahrgenommen / termineGebucht) * 100
        : 0;
    const wonOpps = opportunities.filter((o) => o.status_type === "won");
    const umsatz = wonOpps.reduce((s, o) => s + (o.value ?? 0), 0);
    const closingRate =
      termineWahrgenommen > 0
        ? (wonOpps.length / termineWahrgenommen) * 100
        : 0;

    return {
      leadsNeu: leads.length,
      gespraeche,
      termineGebucht,
      termineWahrgenommen,
      showRate,
      angebote: opportunities.filter(
        (o) => o.status_type === "active"
      ).length + wonOpps.length,
      closes: wonOpps.length,
      umsatz,
      avgDealgroesse: wonOpps.length > 0 ? umsatz / wonOpps.length : 0,
      closingRate,
    };
  }, [leads, opportunities, activities, calendlyEvents]);

  // Funnel
  const funnel = useMemo((): FunnelStep[] => {
    const steps: FunnelStep[] = [
      { label: "Leads", count: kpis.leadsNeu, conversionFromPrev: null },
      {
        label: "Gespräche",
        count: kpis.gespraeche,
        conversionFromPrev:
          kpis.leadsNeu > 0
            ? (kpis.gespraeche / kpis.leadsNeu) * 100
            : 0,
      },
      {
        label: "Termine",
        count: kpis.termineGebucht,
        conversionFromPrev:
          kpis.gespraeche > 0
            ? (kpis.termineGebucht / kpis.gespraeche) * 100
            : 0,
      },
      {
        label: "Shows",
        count: kpis.termineWahrgenommen,
        conversionFromPrev: kpis.showRate,
      },
      {
        label: "Angebote",
        count: kpis.angebote,
        conversionFromPrev:
          kpis.termineWahrgenommen > 0
            ? (kpis.angebote / kpis.termineWahrgenommen) * 100
            : 0,
      },
      {
        label: "Closes",
        count: kpis.closes,
        conversionFromPrev:
          kpis.angebote > 0
            ? (kpis.closes / kpis.angebote) * 100
            : 0,
      },
    ];
    return steps;
  }, [kpis]);

  // Person-Stats
  const personStats = useMemo((): PersonStats[] => {
    return users.map((user) => {
      const userActivities = activities.filter(
        (a) => a.user_id === user.close_id
      );
      const calls = userActivities.filter((a) => a.type === "call");
      const erreicht = calls.filter(
        (a) => a.duration && a.duration > 30
      );
      const durations = erreicht
        .map((a) => a.duration ?? 0)
        .filter((d) => d > 0);
      const avgDauer =
        durations.length > 0
          ? durations.reduce((s, d) => s + d, 0) / durations.length
          : 0;
      const gesamtDauer = durations.reduce((s, d) => s + d, 0);

      // Termine: Calendly-Events die diesem User zugeordnet sind
      // (über host_email → close_users.email Matching, oder über lead_id)
      const userOpps = opportunities.filter(
        (o) => o.user_id === user.close_id
      );
      const wonOpps = userOpps.filter((o) => o.status_type === "won");
      const umsatz = wonOpps.reduce((s, o) => s + (o.value ?? 0), 0);

      return {
        closeId: user.close_id,
        name: user.name,
        rolle: user.rolle,
        anrufeGesamt: calls.length,
        anrufeErreicht: erreicht.length,
        gespraechsquote:
          calls.length > 0
            ? (erreicht.length / calls.length) * 100
            : 0,
        avgGespraechsdauer: avgDauer,
        gespraechszeitGesamt: gesamtDauer,
        termineGesetzt: 0, // TODO: aus Calendly-Zuordnung
        termineProHundert:
          calls.length > 0
            ? (0 / calls.length) * 100
            : 0,
        showRateEigen: 0,
        closesAusEigenen: wonOpps.length,
        umsatzAusEigenen: umsatz,
        termineWahrgenommen: 0,
        angebote: userOpps.filter((o) => o.status_type === "active")
          .length + wonOpps.length,
        closes: wonOpps.length,
        closingRate:
          userOpps.length > 0
            ? (wonOpps.length / userOpps.length) * 100
            : 0,
        umsatz,
        avgDealgroesse:
          wonOpps.length > 0 ? umsatz / wonOpps.length : 0,
      };
    });
  }, [users, activities, opportunities]);

  const openerSetterStats = personStats.filter(
    (p) => p.rolle === "opener" || p.rolle === "setter"
  );
  const closerStats = personStats.filter((p) => p.rolle === "closer");

  // Calendly-Stats
  const calendlyStats = useMemo((): CalendlyStats => {
    const gesamt = calendlyEvents.length;
    const abgesagt = calendlyEvents.filter(
      (e) => e.status === "canceled"
    );
    const noShows = calendlyEvents.filter((e) => e.no_show);
    const stattgefunden = calendlyEvents.filter(
      (e) => e.status === "active" && !e.no_show
    );

    // Absagegründe gruppieren
    const gruende = new Map<string, number>();
    for (const e of abgesagt) {
      const cat = categorizeCancelReason(e.cancel_reason);
      gruende.set(cat, (gruende.get(cat) ?? 0) + 1);
    }

    // Nach Vorlaufzeit
    const now = Date.now();
    let ueber24h = 0;
    let unter24h = 0;
    let unter2h = 0;
    for (const e of abgesagt) {
      const scheduled = new Date(e.scheduled_at).getTime();
      const vorlauf = scheduled - now;
      if (vorlauf > 24 * 60 * 60 * 1000) ueber24h++;
      else if (vorlauf > 2 * 60 * 60 * 1000) unter24h++;
      else unter2h++;
    }

    return {
      gesamt,
      stattgefunden: stattgefunden.length,
      abgesagt: abgesagt.length,
      noShow: noShows.length,
      absageQuote: gesamt > 0 ? (abgesagt.length / gesamt) * 100 : 0,
      absagegruende: Array.from(gruende.entries())
        .map(([grund, anzahl]) => ({ grund, anzahl }))
        .sort((a, b) => b.anzahl - a.anzahl),
      absagenNachVorlauf: { ueber24h, unter24h, unter2h },
      absagenNachPartei: {
        invitee: abgesagt.filter((e) => e.canceled_by === "invitee")
          .length,
        host: abgesagt.filter((e) => e.canceled_by === "host").length,
      },
    };
  }, [calendlyEvents]);

  const hasData =
    leads.length > 0 ||
    activities.length > 0 ||
    calendlyEvents.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sales-Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Letzte 90 Tage — Close + Calendly
        </p>
      </div>

      {!hasData ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
          <p className="text-sm font-medium">Noch keine Sync-Daten</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Daten werden nach Anbindung von Close und Calendly automatisch
            synchronisiert (stündlich).
          </p>
        </div>
      ) : (
        <>
          {/* KPI-Zeile */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: "Leads", value: kpis.leadsNeu.toString() },
              { label: "Gespräche", value: kpis.gespraeche.toString() },
              {
                label: "Termine gebucht",
                value: kpis.termineGebucht.toString(),
              },
              {
                label: "Show-Rate",
                value: formatPercent(kpis.showRate),
              },
              { label: "Closes", value: kpis.closes.toString() },
              { label: "Umsatz", value: formatEuro(kpis.umsatz) },
              {
                label: "Ø Dealgröße",
                value: formatEuro(kpis.avgDealgroesse),
              },
              {
                label: "Closing-Rate",
                value: formatPercent(kpis.closingRate),
              },
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

          {/* Funnel */}
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium mb-3">
              Funnel
            </h2>
            <div className="flex items-end gap-2 overflow-x-auto pb-2">
              {funnel.map((step, i) => {
                const maxCount = Math.max(...funnel.map((s) => s.count), 1);
                const heightPct = (step.count / maxCount) * 100;
                return (
                  <div
                    key={step.label}
                    className="flex flex-1 min-w-16 flex-col items-center gap-1"
                  >
                    {step.conversionFromPrev !== null && i > 0 && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {formatPercent(step.conversionFromPrev)}
                      </span>
                    )}
                    <div
                      className="w-full rounded-t bg-primary/80 transition-all min-h-2"
                      style={{ height: `${Math.max(heightPct, 4)}px`, maxHeight: "120px" }}
                    />
                    <span className="text-lg font-bold font-mono">
                      {step.count}
                    </span>
                    <span className="text-[10px] text-muted-foreground text-center">
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tabs: Opener/Closer/Calendly */}
          <Tabs defaultValue="opener">
            <TabsList>
              <TabsTrigger value="opener">
                Opener / Setter
              </TabsTrigger>
              <TabsTrigger value="closer">
                Closer
              </TabsTrigger>
              <TabsTrigger value="calendly">
                Calendly
              </TabsTrigger>
            </TabsList>

            {/* Opener/Setter */}
            <TabsContent value="opener" className="mt-4">
              {openerSetterStats.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  Keine Opener/Setter in Close konfiguriert. Rollen können im
                  Admin-Bereich zugewiesen werden.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                          Name
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Anrufe
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Erreicht
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Quote
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Ø Dauer
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Gesamt
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Closes
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Umsatz
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {openerSetterStats.map((p) => (
                        <tr key={p.closeId} className="hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">
                            {p.name}
                            <span className="ml-1.5 text-[10px] text-muted-foreground">
                              {p.rolle}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {p.anrufeGesamt}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {p.anrufeErreicht}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatPercent(p.gespraechsquote)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatSeconds(p.avgGespraechsdauer)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatSeconds(p.gespraechszeitGesamt)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {p.closesAusEigenen}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatEuro(p.umsatzAusEigenen)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* Closer */}
            <TabsContent value="closer" className="mt-4">
              {closerStats.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  Keine Closer in Close konfiguriert.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                          Name
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Angebote
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Closes
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Closing-Rate
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Umsatz
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          Ø Deal
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {closerStats.map((p) => (
                        <tr key={p.closeId} className="hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">
                            {p.name}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {p.angebote}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {p.closes}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatPercent(p.closingRate)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatEuro(p.umsatz)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatEuro(p.avgDealgroesse)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* Calendly */}
            <TabsContent value="calendly" className="mt-4 space-y-4">
              {/* Calendly KPIs */}
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Termine
                  </p>
                  <p className="mt-0.5 text-xl font-bold font-mono">
                    {calendlyStats.gesamt}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Stattgefunden
                  </p>
                  <p className="mt-0.5 text-xl font-bold font-mono">
                    {calendlyStats.stattgefunden}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Absagequote
                  </p>
                  <p className="mt-0.5 text-xl font-bold font-mono">
                    {formatPercent(calendlyStats.absageQuote)}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    No-Shows
                  </p>
                  <p className="mt-0.5 text-xl font-bold font-mono">
                    {calendlyStats.noShow}
                  </p>
                </div>
              </div>

              {/* Absagegründe */}
              {calendlyStats.absagegruende.length > 0 && (
                <div className="rounded-lg border bg-card p-4">
                  <h3 className="text-xs font-medium mb-2">Absagegründe</h3>
                  <div className="space-y-1.5">
                    {calendlyStats.absagegruende.map((g) => (
                      <div
                        key={g.grund}
                        className="flex items-center justify-between text-sm"
                      >
                        <span>{g.grund}</span>
                        <span className="font-mono text-muted-foreground">
                          {g.anzahl}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Absagen nach Vorlaufzeit + Partei */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-card p-4">
                  <h3 className="text-xs font-medium mb-2">
                    Absagen nach Vorlaufzeit
                  </h3>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span>&gt; 24 Stunden</span>
                      <span className="font-mono">
                        {calendlyStats.absagenNachVorlauf.ueber24h}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>2–24 Stunden</span>
                      <span className="font-mono">
                        {calendlyStats.absagenNachVorlauf.unter24h}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>&lt; 2 Stunden</span>
                      <span className="font-mono text-sla-rot font-medium">
                        {calendlyStats.absagenNachVorlauf.unter2h}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <h3 className="text-xs font-medium mb-2">
                    Wer hat abgesagt?
                  </h3>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span>Eingeladener</span>
                      <span className="font-mono">
                        {calendlyStats.absagenNachPartei.invitee}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Host</span>
                      <span className="font-mono">
                        {calendlyStats.absagenNachPartei.host}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
