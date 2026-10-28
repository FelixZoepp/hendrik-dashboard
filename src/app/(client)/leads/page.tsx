import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { istStufe } from "@/lib/crm/logik";
import { LeadsView, type StufenFilter } from "./leads-view";
import type { Lead } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Anfragen",
};

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireKunde();
  const sp = await searchParams;
  const db = createAdminClient();

  const [leadsRes, personenRes] = await Promise.all([
    db.from("leads").select("*").eq("company_id", ctx.companyId).order("created_at", { ascending: false }),
    db.from("profiles").select("id, full_name").eq("company_id", ctx.companyId).eq("active", true),
  ]);

  const namen: Record<string, string> = {};
  for (const p of (personenRes.data ?? []) as { id: string; full_name: string | null }[]) {
    namen[p.id] = p.full_name || "Ohne Namen";
  }

  const roh = Array.isArray(sp.stufe) ? sp.stufe[0] : sp.stufe;
  const startStufe: StufenFilter = roh === "alle" || roh === "offen" || istStufe(roh) ? roh : "offen";

  return <LeadsView leads={(leadsRes.data as Lead[]) ?? []} namen={namen} startStufe={startStufe} />;
}
