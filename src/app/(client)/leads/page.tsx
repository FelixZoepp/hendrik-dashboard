import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { LeadsView } from "./leads-view";
import type { Lead } from "@/lib/types/database";

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

  let query = supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  // Clients sehen nur ihre Company-Leads (RLS macht das auch, aber explizit filtern ist schneller)
  if (profile.company_id) {
    query = query.eq("company_id", profile.company_id);
  }

  const { data: leads } = await query;

  return <LeadsView leads={(leads as Lead[]) ?? []} isStaff={!profile.company_id} />;
}
