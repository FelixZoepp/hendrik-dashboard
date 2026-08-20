import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

import { SalesDashboard } from "./sales-dashboard";
import { PeriodFilter, getDaysFromSearchParams } from "@/components/ui/period-filter";
import { subDays } from "date-fns";

export const metadata: Metadata = {
  title: "Sales",
};

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {

  const supabase = await createClient();
  const params = await searchParams;
  const days = getDaysFromSearchParams(params);

  const since = subDays(new Date(), days).toISOString();
  const sinceDate = subDays(new Date(), days).toISOString().split("T")[0];

  // Vorperiode für Delta-Vergleich
  const prevStart = subDays(new Date(), days * 2).toISOString();
  const prevEnd = since;
  const prevDate = subDays(new Date(), days * 2).toISOString().split("T")[0];
  const prevEndDate = sinceDate;

  const [
    usersRes, leadsRes, oppsRes, activitiesRes, calendlyRes, metaRes,
    prevLeadsRes, prevOppsRes, prevCalendlyRes, prevMetaRes,
  ] = await Promise.all([
    supabase.from("close_users").select("*"),
    supabase.from("close_leads").select("*").gte("date_created", since),
    supabase.from("close_opportunities").select("*").gte("date_created", since),
    supabase.from("close_activities").select("*").gte("date_created", since),
    supabase.from("calendly_events").select("*").gte("scheduled_at", since),
    supabase.from("meta_ad_insights").select("spend").gte("date", sinceDate),
    // Vorperiode
    supabase.from("close_leads").select("close_id").gte("date_created", prevStart).lt("date_created", prevEnd),
    supabase.from("close_opportunities").select("close_id, value, status_type").gte("date_created", prevStart).lt("date_created", prevEnd),
    supabase.from("calendly_events").select("calendly_uri, status, no_show").gte("scheduled_at", prevStart).lt("scheduled_at", prevEnd),
    supabase.from("meta_ad_insights").select("spend").gte("date", prevDate).lt("date", prevEndDate),
  ]);

  const metaSpend = (metaRes.data ?? []).reduce(
    (sum: number, r: { spend: number }) => sum + Number(r.spend), 0
  );

  // Vorperioden-KPIs für Delta
  const prevLeads = (prevLeadsRes.data ?? []).length;
  const prevWon = (prevOppsRes.data ?? []).filter((o: { status_type: string }) => o.status_type === "won");
  const prevUmsatz = prevWon.reduce((s: number, o: { value: number }) => s + (o.value ?? 0), 0);
  const prevCalendly = (prevCalendlyRes.data ?? []);
  const prevShows = prevCalendly.filter((e: { status: string; no_show: boolean }) => e.status === "active" && !e.no_show).length;
  const prevMetaSpend = (prevMetaRes.data ?? []).reduce(
    (sum: number, r: { spend: number }) => sum + Number(r.spend), 0
  );

  const prevPeriod = {
    leads: prevLeads,
    closes: prevWon.length,
    umsatz: prevUmsatz,
    termineWahrgenommen: prevShows,
    metaSpend: prevMetaSpend,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sales-Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Letzte {days} Tage — Close + Calendly
          </p>
        </div>
        <Suspense>
          <PeriodFilter />
        </Suspense>
      </div>
      <SalesDashboard
        users={usersRes.data ?? []}
        leads={leadsRes.data ?? []}
        opportunities={oppsRes.data ?? []}
        activities={activitiesRes.data ?? []}
        calendlyEvents={calendlyRes.data ?? []}
        metaSpend={metaSpend}
        prevPeriod={prevPeriod}
      />
    </div>
  );
}
