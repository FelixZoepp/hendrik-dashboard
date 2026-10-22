import type { SupabaseClient } from "@supabase/supabase-js";
import { ladeBeispielDokumentHoch, listeVorlagenMeta, reicheVorlageEinMeta, terminBasisUrl } from "./client";
import { ladeFunnelEinstellungen } from "@/lib/funnel/einstellungen";
import { speichereEinstellung } from "./einstellungen";
import { metaDefinition, pruefeVorlage, VORLAGEN, vorlageNachName } from "./vorlagen";

/**
 * Vorlagen bei Meta einreichen (echte Aktion — nur per Knopf im Dashboard)
 * und Freigabe-Status abgleichen (nur lesen — auch stündlich per Cron).
 */

export async function reicheVorlageEin(svc: SupabaseClient, name: string): Promise<{ status: string; metaId: string }> {
  const v = vorlageNachName(name);
  if (!v) throw new Error(`Unbekannte Vorlage ${name}`);
  const probleme = pruefeVorlage(v);
  if (probleme.length) throw new Error(`Vorlage ${name} verletzt Meta-Regeln: ${probleme.join("; ")}`);

  let handle: string | undefined;
  if (v.headerDokument) {
    // Beispiel-PDF: erster Funnel mit hinterlegtem Report
    const pdf = Object.values((await ladeFunnelEinstellungen(svc)).funnels).find((f) => f.report_url)?.report_url;
    if (!pdf) throw new Error("Erst bei einem Funnel das Report-PDF hinterlegen (/sales/funnels) – Meta braucht ein Beispiel");
    handle = await ladeBeispielDokumentHoch(pdf);
  }
  const r = await reicheVorlageEinMeta(metaDefinition(v, terminBasisUrl(), handle));
  const jetzt = new Date().toISOString();
  const { error } = await svc.from("wa_vorlagen").upsert(
    {
      name: v.name,
      kategorie: (r.category ?? v.kategorie).toUpperCase(),
      sprache: v.sprache,
      status: r.status.toUpperCase(),
      meta_id: r.id,
      ablehnungsgrund: null,
      eingereicht_am: jetzt,
      geprueft_am: jetzt,
    },
    { onConflict: "name" },
  );
  if (error) throw new Error(`Vorlage eingereicht, aber nicht gespeichert: ${error.message}`);
  return { status: r.status, metaId: r.id };
}

/** Status aller eigenen Vorlagen bei Meta abfragen und in wa_vorlagen nachziehen. */
export async function gleicheVorlagenAb(svc: SupabaseClient): Promise<number> {
  const namen = new Set(VORLAGEN.map((v) => v.name));
  const meta = (await listeVorlagenMeta()).filter((t) => namen.has(t.name as never) && t.language === "de");
  const jetzt = new Date().toISOString();
  for (const t of meta) {
    const { error } = await svc.from("wa_vorlagen").upsert(
      {
        name: t.name,
        kategorie: t.category?.toUpperCase() ?? null,
        sprache: t.language,
        status: t.status.toUpperCase() === "REINSTATED" ? "APPROVED" : t.status.toUpperCase(),
        meta_id: t.id,
        ablehnungsgrund: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
        geprueft_am: jetzt,
      },
      { onConflict: "name" },
    );
    if (error) throw new Error(`Vorlage ${t.name} nicht gespeichert: ${error.message}`);
  }
  await speichereEinstellung(svc, "vorlagen_abgleich_am", jetzt);
  return meta.length;
}
