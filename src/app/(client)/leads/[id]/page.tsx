import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { LeadDetail } from "./lead-detail";
import type { Lead, LeadActivity, Profile } from "@/lib/types/database";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { companyId } = await requireKunde();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("leads")
    .select("vorname, nachname")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();

  return {
    title: data ? `${data.vorname} ${data.nachname}` : "Lead",
  };
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { companyId } = await requireKunde();
  const supabase = createAdminClient();

  const { data: leadRow } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!leadRow) {
    notFound();
  }

  const lead = leadRow as Lead;
  const activitiesResult = await supabase
    .from("lead_activities")
    .select("*")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false });

  // Resolve assignee name
  let assigneeName: string | null = null;
  if (lead.assigned_to) {
    const { data: assignee } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", lead.assigned_to)
      .single();
    assigneeName = (assignee as Pick<Profile, "full_name"> | null)?.full_name ?? null;
  }

  return (
    <LeadDetail
      lead={lead}
      activities={(activitiesResult.data as LeadActivity[]) ?? []}
      assigneeName={assigneeName}
      isStaff={false}
    />
  );
}
