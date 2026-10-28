import { createAdminClient } from "@/lib/supabase/admin";
import { GlockeKnopf, type Meldung } from "./glocke-knopf";

/**
 * Glocke mit Zähler für das Kundenportal (neue Leads usw.).
 * Aufrufer übergibt ctx.companyId / ctx.profile.id aus requireKunde() – alle Abfragen filtern auf die Firma.
 */
export async function Glocke({ companyId, userId, impersoniert }: { companyId: string; userId: string; impersoniert: boolean }) {
  const { data, error } = await createAdminClient()
    .from("benachrichtigungen")
    .select("id, typ, titel, text, link, gelesen_am, created_at")
    .eq("company_id", companyId)
    .or(`user_id.is.null,user_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(20);
  // Tabelle fehlt (Migration 00014 noch nicht eingespielt) → keine Glocke statt Fehlerseite
  if (error) return null;
  const meldungen = (data ?? []) as Meldung[];
  return <GlockeKnopf meldungen={meldungen} nurAnsehen={impersoniert} />;
}
