import type { Metadata } from "next";
import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

import { MarketingDashboard } from "./marketing-dashboard";
import { PeriodFilter } from "@/components/ui/period-filter";
import { getDaysFromSearchParams } from "@/lib/period-utils";
import { subDays } from "date-fns";

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

  const since = subDays(new Date(), days).toISOString().split("T")[0];
  const sinceTs = subDays(new Date(), days).toISOString();

  const [metaRes, googleRes, oppsRes, calendlyRes] = await Promise.all([
    supabase
      .from("meta_ad_insights")
      .select("*")
      .gte("date", since)
      .order("date", { ascending: false }),
    supabase
      .from("google_ads_insights")
      .select("*, companies(name)")
      .gte("date", since)
      .order("date", { ascending: false }),
    supabase
      .from("close_opportunities")
      .select("value, status_type, lead_id, date_won")
      .eq("status_type", "won"),
    supabase
      .from("calendly_events")
      .select("event_type_name, status, no_show, scheduled_at")
      .gte("scheduled_at", sinceTs),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marketing-Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {days >= 9999 ? "Alle Daten" : `Letzte ${days} Tage`} — Meta Ads
          </p>
        </div>
        <Suspense>
          <PeriodFilter />
        </Suspense>
      </div>
      <MarketingDashboard
        metaInsights={metaRes.data ?? []}
        googleInsights={googleRes.data ?? []}
        wonOpportunities={oppsRes.data ?? []}
        calendlyEvents={calendlyRes.data ?? []}
      />
    </div>
  );
}
