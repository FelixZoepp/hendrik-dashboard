import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { LeadsView } from "./leads-view";
import type { Lead } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Leads",
};

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const { companyId } = await requireKunde();
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("leads")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  return <LeadsView leads={(data as Lead[]) ?? []} isStaff={false} userCompanyId={companyId} />;
}
