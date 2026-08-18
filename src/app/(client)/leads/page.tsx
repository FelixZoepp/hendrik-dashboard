import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { LeadsView } from "./leads-view";
import type { Lead, Company } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Leads",
};

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const profile = await requireRole([
    "admin",
    "client_owner",
    "client_member",
  ]);
  const supabase = await createClient();
  const isStaff = !profile.company_id;

  let query = supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  // Clients sehen nur ihre Company-Leads (RLS macht das auch, aber explizit filtern ist schneller)
  if (profile.company_id) {
    query = query.eq("company_id", profile.company_id);
  }

  // Staff braucht die Firmenliste für den Lead-anlegen Dialog
  const [leadsResult, companiesResult] = await Promise.all([
    query,
    isStaff
      ? supabase
          .from("companies")
          .select("id, name")
          .order("name", { ascending: true })
      : Promise.resolve({ data: null }),
  ]);

  return (
    <LeadsView
      leads={(leadsResult.data as Lead[]) ?? []}
      isStaff={isStaff}
      companies={
        isStaff
          ? ((companiesResult.data as Pick<Company, "id" | "name">[]) ?? [])
          : undefined
      }
      userCompanyId={profile.company_id}
    />
  );
}
