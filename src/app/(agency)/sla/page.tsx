import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { SlaOverview } from "./sla-overview";
import { PeriodFilter, getDaysFromSearchParams } from "@/components/ui/period-filter";
import { subDays } from "date-fns";
import type { LeadSla, Company } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Reaktionszeiten",
};

export const dynamic = "force-dynamic";

export default async function SlaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const params = await searchParams;
  const days = getDaysFromSearchParams(params);
  const since = subDays(new Date(), days).toISOString();

  const [slaResult, companiesResult] = await Promise.all([
    supabase.from("lead_sla").select("*").gte("created_at", since),
    supabase
      .from("companies")
      .select("id, name, status")
      .in("status", ["aktiv", "onboarding"]),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reaktionszeiten</h1>
          <p className="text-sm text-muted-foreground">
            Letzte {days} Tage — SLA-Übersicht
          </p>
        </div>
        <Suspense>
          <PeriodFilter />
        </Suspense>
      </div>
      <SlaOverview
        slaData={(slaResult.data as LeadSla[]) ?? []}
        companies={(companiesResult.data as Company[]) ?? []}
      />
    </div>
  );
}
