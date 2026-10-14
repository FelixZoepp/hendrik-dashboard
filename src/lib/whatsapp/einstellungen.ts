import type { SupabaseClient } from "@supabase/supabase-js";
import { VORLAGEN_NAMEN } from "./vorlagen";

/** Einstellungen des WhatsApp-Terminbots (Tabelle wa_einstellungen, Schlüssel → jsonb). */
export interface WaEinstellungen {
  bot_aktiv: boolean;
  testnummern: string[];
  vorlagen_aktiv: Record<string, boolean>;
  /** Close-Feld (z. B. "custom.cf_…" oder Feldname) mit „Ja“ = WhatsApp-Einwilligung; null = Close-Termine senden nie */
  close_optin_feld: string | null;
  /** Close-Lead-Feld „WhatsApp-Termin“ (z. B. "custom.cf_…") für den Bestätigungsstatus; null = nicht setzen */
  close_status_feld: string | null;
  videos: { erstgespraech: string | null; strategie: string | null };
  buchungslinks: { erstgespraech: string | null; strategie: string | null };
  vorlagen_abgleich_am: string | null;
}

export const STANDARD_EINSTELLUNGEN: WaEinstellungen = {
  bot_aktiv: false,
  testnummern: [],
  vorlagen_aktiv: Object.fromEntries(VORLAGEN_NAMEN.map((n) => [n, false])),
  close_optin_feld: null,
  close_status_feld: null,
  videos: { erstgespraech: null, strategie: null },
  buchungslinks: { erstgespraech: null, strategie: null },
  vorlagen_abgleich_am: null,
};

export async function ladeEinstellungen(svc: SupabaseClient): Promise<WaEinstellungen> {
  const { data, error } = await svc.from("wa_einstellungen").select("key, wert");
  if (error) throw new Error(`Einstellungen nicht lesbar: ${error.message}`);
  const e: WaEinstellungen = structuredClone(STANDARD_EINSTELLUNGEN);
  for (const row of (data ?? []) as Array<{ key: string; wert: unknown }>) {
    const w = row.wert;
    switch (row.key) {
      case "bot_aktiv":
        e.bot_aktiv = w === true;
        break;
      case "testnummern":
        e.testnummern = Array.isArray(w) ? w.filter((x): x is string => typeof x === "string") : [];
        break;
      case "vorlagen_aktiv":
        if (w && typeof w === "object") {
          for (const [k, v] of Object.entries(w as Record<string, unknown>)) e.vorlagen_aktiv[k] = v === true;
        }
        break;
      case "close_optin_feld":
      case "close_status_feld":
        e[row.key] = typeof w === "string" && w.trim() ? w.trim() : null;
        break;
      case "videos":
      case "buchungslinks":
        if (w && typeof w === "object") {
          const o = w as Record<string, unknown>;
          const url = (x: unknown) => (typeof x === "string" && /^https?:\/\//.test(x.trim()) ? x.trim() : null);
          e[row.key] = { erstgespraech: url(o.erstgespraech), strategie: url(o.strategie) };
        }
        break;
      case "vorlagen_abgleich_am":
        e.vorlagen_abgleich_am = typeof w === "string" ? w : null;
        break;
    }
  }
  return e;
}

export async function speichereEinstellung<K extends keyof WaEinstellungen>(
  svc: SupabaseClient,
  key: K,
  wert: WaEinstellungen[K],
): Promise<void> {
  const { error } = await svc
    .from("wa_einstellungen")
    .upsert({ key, wert, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`Einstellung ${key} nicht gespeichert: ${error.message}`);
}
