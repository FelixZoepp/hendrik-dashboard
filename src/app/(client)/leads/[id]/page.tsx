import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { istUuid } from "@/lib/zugriff";
import { LeadDetail } from "./lead-detail";
import type { Lead, LeadActivity } from "@/lib/types/database";
import type { TerminZeile } from "@/components/auswertung/termin-karten";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { companyId } = await requireKunde();
  if (!istUuid(id)) return { title: "Anfrage" };
  const { data } = await createAdminClient()
    .from("leads")
    .select("vorname, nachname")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  return { title: data ? `${data.vorname} ${data.nachname}`.trim() || "Anfrage" : "Anfrage" };
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireKunde();
  if (!istUuid(id)) notFound();
  const db = createAdminClient();

  const { data: leadRow } = await db.from("leads").select("*").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!leadRow) notFound();
  const lead = leadRow as Lead;

  // Kind-Tabelle erst nach Prüfung des Elternteils (Lead gehört zur Firma)
  const [aktRes, personenRes, termineRes] = await Promise.all([
    db.from("lead_activities").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }),
    db.from("profiles").select("id, full_name").eq("company_id", ctx.companyId).eq("active", true).order("full_name"),
    // Fehlt die Tabelle (Migration 00018), bleibt die Liste einfach leer
    db
      .from("lead_termine")
      .select("id, lead_id, art, beginn, status, ersetzt_termin_id, created_at")
      .eq("lead_id", lead.id)
      .eq("company_id", ctx.companyId)
      .order("beginn", { ascending: false }),
  ]);
  const termine = (termineRes.error ? [] : termineRes.data ?? []) as TerminZeile[];
  const aktivitaeten = (aktRes.data as LeadActivity[]) ?? [];
  const personen = ((personenRes.data ?? []) as { id: string; full_name: string | null }[]).map((p) => ({
    id: p.id,
    name: p.full_name || "Ohne Namen",
  }));

  // Namen im Verlauf (auch Team-Mitglieder, die über „Als Kunde ansehen“ gearbeitet haben)
  const namen: Record<string, string> = Object.fromEntries(personen.map((p) => [p.id, p.name]));
  const fehlend = [...new Set(aktivitaeten.map((a) => a.user_id).filter((u): u is string => !!u && !namen[u]))];
  if (lead.assigned_to && !namen[lead.assigned_to]) fehlend.push(lead.assigned_to);
  if (fehlend.length > 0) {
    const { data } = await db.from("profiles").select("id, full_name, company_id, role").in("id", fehlend);
    for (const p of (data ?? []) as { id: string; full_name: string | null; company_id: string | null; role: string }[]) {
      const istTeam = ["admin", "sales", "fulfillment"].includes(p.role);
      namen[p.id] = istTeam ? "Hoffmann Solutions" : p.full_name || "Ohne Namen";
    }
  }

  return (
    <LeadDetail
      lead={lead}
      aktivitaeten={aktivitaeten}
      personen={personen}
      namen={namen}
      firmenName={ctx.company.name}
      anrufFrage={sp.anruf === "1"}
      termine={termine}
      jetztIso={new Date().toISOString()}
    />
  );
}
