import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { SalesDashboard } from "./sales-dashboard";
import { subDays } from "date-fns";

export const metadata: Metadata = {
  title: "Sales",
};

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  await requireRole(["admin", "sales"]);
  const supabase = await createClient();

  // Default: 90 Tage
  const since = subDays(new Date(), 90).toISOString();

  const [usersRes, leadsRes, oppsRes, activitiesRes, calendlyRes] =
    await Promise.all([
      supabase.from("close_users").select("*"),
      supabase
        .from("close_leads")
        .select("*")
        .gte("date_created", since),
      supabase
        .from("close_opportunities")
        .select("*")
        .gte("date_created", since),
      supabase
        .from("close_activities")
        .select("*")
        .gte("date_created", since),
      supabase
        .from("calendly_events")
        .select("*")
        .gte("scheduled_at", since),
    ]);

  return (
    <SalesDashboard
      users={usersRes.data ?? []}
      leads={leadsRes.data ?? []}
      opportunities={oppsRes.data ?? []}
      activities={activitiesRes.data ?? []}
      calendlyEvents={calendlyRes.data ?? []}
    />
  );
}
