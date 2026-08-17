import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { LeadDetail } from "./lead-detail";
import type { Lead, LeadActivity } from "@/lib/types/database";
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
  await requireRole(["admin", "client_owner", "client_member"]);

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

  return (
    <LeadDetail
      lead={leadResult.data as Lead}
      activities={(activitiesResult.data as LeadActivity[]) ?? []}
    />
  );
}
