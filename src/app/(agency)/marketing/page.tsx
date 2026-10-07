import type { Metadata } from "next";
import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

import { MarketingDashboard, type MarketingDashboardProps } from "./marketing-dashboard";
import { PeriodFilter } from "@/components/ui/period-filter";
import { getDaysFromSearchParams, getPeriod, berlinDateString } from "@/lib/period-utils";

export const metadata: Metadata = { title: "Marketing" };
export const dynamic = "force-dynamic";

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = createAdminClient();
  const params = await searchParams;
  const days = getDaysFromSearchParams(params);

  const period = getPeriod(days);
  const since = berlinDateString(period.start);
  const sinceTs = period.start.toISOString();
  const untilTs = period.end.toISOString();

  const [meta, google, wonOpps, calendly] = await Promise.all([
    fetchAll<MarketingDashboardProps["metaInsights"][number]>(() =>
      supabase
        .from("meta_ad_insights")
        .select("*", { count: "exact" })
        .gte("date", since)
        .order("date", { ascending: false })
        .order("id")
    ),
    fetchAll<MarketingDashboardProps["googleInsights"][number]>(() =>
      supabase
        .from("google_ads_insights")
        .select("*, companies(name)", { count: "exact" })
        .gte("date", since)
        .order("date", { ascending: false })
        .order("id")
    ),
    // Gewonnene Deals im Zeitraum (nach Abschlussdatum)
    fetchAll<MarketingDashboardProps["wonOpportunities"][number]>(() =>
      supabase
        .from("close_opportunities")
        .select("value, status_type, lead_id, date_won", { count: "exact" })
        .eq("status_type", "won")
        .gte("date_won", sinceTs)
        .lt("date_won", untilTs)
        .order("close_id")
    ),
    // nur bereits stattgefundene Zeitpunkte — der Sync lädt auch kommende Termine
    fetchAll<MarketingDashboardProps["calendlyEvents"][number]>(() =>
      supabase
        .from("calendly_events")
        .select("event_type_name, status, no_show, scheduled_at", { count: "exact" })
        .gte("scheduled_at", sinceTs)
        .lt("scheduled_at", untilTs)
        .order("calendly_uri")
    ),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="fern-page-title">Marketing-Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} · {period.rangeLabel} — Meta Ads
          </p>
        </div>
        <Suspense>
          <PeriodFilter />
        </Suspense>
      </div>
      <MarketingDashboard
        metaInsights={meta}
        googleInsights={google}
        wonOpportunities={wonOpps}
        calendlyEvents={calendly}
      />
    </div>
  );
}
