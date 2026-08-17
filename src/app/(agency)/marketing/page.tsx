import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { MarketingDashboard } from "./marketing-dashboard";
import { subDays } from "date-fns";

export const metadata: Metadata = { title: "Marketing" };
export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const since = subDays(new Date(), 90).toISOString().split("T")[0];

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
    <MarketingDashboard
      metaInsights={metaRes.data ?? []}
      googleInsights={googleRes.data ?? []}
      wonOpportunities={oppsRes.data ?? []}
    />
  );
}
