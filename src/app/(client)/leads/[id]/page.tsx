import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
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
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("vorname, nachname")
    .eq("id", id)
    .single();

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
  const profile = await requireRole(["admin", "client_owner", "client_member"]);
  const isStaff = !profile.company_id;

  const supabase = await createClient();

  const [leadResult, activitiesResult] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).single(),
    supabase
      .from("lead_activities")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!leadResult.data) {
    notFound();
  }

  const lead = leadResult.data as Lead;

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
      isStaff={isStaff}
    />
  );
}
