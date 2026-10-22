import type { SupabaseClient } from "@supabase/supabase-js";
import { leseFunnels, type FunnelEinstellung } from "./logik";

/** Schalter + Funnel-Einstellungen (Tabelle wa_einstellungen). Alles standardmäßig aus. */
export interface FunnelEinstellungen {
  /** Eintragungen → Close-Lead, 10-Min.-Prüfung, Aufgabe + Slack */
  closeAktiv: boolean;
  /** PDF-Report und Erinnerung per WhatsApp (zusätzlich gelten Bot-Schalter/Testnummern und Vorlagen-Schalter) */
  whatsappAktiv: boolean;
  funnels: Record<string, FunnelEinstellung>;
}

export async function ladeFunnelEinstellungen(svc: SupabaseClient): Promise<FunnelEinstellungen> {
  const { data, error } = await svc
    .from("wa_einstellungen")
    .select("key, wert")
    .in("key", ["funnel_close_aktiv", "funnel_whatsapp_aktiv", "funnels"]);
  if (error) throw new Error(`Funnel-Einstellungen nicht lesbar: ${error.message}`);
  const w = new Map(((data ?? []) as Array<{ key: string; wert: unknown }>).map((r) => [r.key, r.wert]));
  return {
    closeAktiv: w.get("funnel_close_aktiv") === true,
    whatsappAktiv: w.get("funnel_whatsapp_aktiv") === true,
    funnels: leseFunnels(w.get("funnels")),
  };
}

export async function speichereFunnelWert(
  svc: SupabaseClient,
  key: "funnel_close_aktiv" | "funnel_whatsapp_aktiv" | "funnels",
  wert: unknown,
): Promise<void> {
  const { error } = await svc
    .from("wa_einstellungen")
    .upsert({ key, wert, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`Einstellung ${key} nicht gespeichert: ${error.message}`);
}
