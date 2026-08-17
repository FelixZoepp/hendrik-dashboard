import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { SlaOverview } from "./sla-overview";
import type { LeadSla, Company } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Reaktionszeiten",
};

export const dynamic = "force-dynamic";

export default async function SlaPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const [slaResult, companiesResult] = await Promise.all([
    supabase.from("lead_sla").select("*"),
    supabase
      .from("companies")
      .select("id, name, status")
      .in("status", ["aktiv", "onboarding"]),
  ]);

  return (
    <SlaOverview
      slaData={(slaResult.data as LeadSla[]) ?? []}
      companies={(companiesResult.data as Company[]) ?? []}
    />
  );
}
