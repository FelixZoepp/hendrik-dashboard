import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

import { MarketingDashboard } from "./marketing-dashboard";
import { PeriodFilter, getDaysFromSearchParams } from "@/components/ui/period-filter";
import { subDays } from "date-fns";

export const metadata: Metadata = { title: "Marketing" };
export const dynamic = "force-dynamic";

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {

  const supabase = await createClient();
  const params = await searchParams;
  const days = getDaysFromSearchParams(params);

  const since = subDays(new Date(), days).toISOString().split("T")[0];

  const [metaRes, googleRes, oppsRes] = await Promise.all([
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
      .select("value, status_type, lead_id")
      .eq("status_type", "won"),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Marketing-Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Letzte {days} Tage — Meta Ads + Google Ads
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
      />
    </div>
  );
}
