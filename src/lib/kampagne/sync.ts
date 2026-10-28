/**
 * Abgleich der Werbekosten je Firma → kampagnen_kosten_tag.
 * Liest Meta (nur GET) und google_ads_insights; schreibt ausschließlich in die eigenen Tabellen
 * (kampagnen_kosten_tag, fehlende Zuordnungen aus eigenen Werbekonten, sync_log mit source „kampagnen“).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  berlinDatum,
  fasseZusammen,
  leseMetaInsight,
  ordneZu,
  plusTage,
  type KostenZeile,
  type Werbekonto,
  type ZugeordneteKostenZeile,
  type Zuordnung,
} from "./logik";
import { ladeKampagnenInsights, metaKonfig } from "./meta";

export const SYNC_TAGE = 30;
const BATCH = 500;

export interface SyncErgebnis {
  zeilen: number;
  firmen: number;
  konten: number;
  ohneFirma: string[];
  fehler: string[];
}

function metaZeilen(insights: Awaited<ReturnType<typeof ladeKampagnenInsights>>): KostenZeile[] {
  return fasseZusammen(insights.map(leseMetaInsight).filter((z): z is KostenZeile => !!z));
}

/** Abgleich aller Firmen (Cron) oder nur einer Firma („Jetzt abgleichen“). */
export async function syncKampagnen(
  db: SupabaseClient,
  opts: { companyId?: string; tage?: number; now?: Date } = {},
): Promise<SyncErgebnis> {
  const now = opts.now ?? new Date();
  const until = berlinDatum(now);
  const since = plusTage(until, -((opts.tage ?? SYNC_TAGE) - 1));
  const ergebnis: SyncErgebnis = { zeilen: 0, firmen: 0, konten: 0, ohneFirma: [], fehler: [] };

  const [zRes, kRes] = await Promise.all([
    db.from("kampagnen_zuordnung").select("company_id, plattform, kampagne_id, kampagne_name, werbekonto_id, aktiv"),
    db.from("kampagnen_werbekonto").select("company_id, plattform, werbekonto_id, aktiv").eq("aktiv", true),
  ]);
  if (zRes.error) throw new Error(`kampagnen_zuordnung: ${zRes.error.message}`);
  if (kRes.error) throw new Error(`kampagnen_werbekonto: ${kRes.error.message}`);
  const zuordnungen = (zRes.data ?? []) as Zuordnung[];
  const konten = ((kRes.data ?? []) as Werbekonto[]).filter(
    (k) => k.plattform === "meta" && (!opts.companyId || k.company_id === opts.companyId),
  );

  const fuerFirma = (z: { company_id: string }) => !opts.companyId || z.company_id === opts.companyId;
  const alle: ZugeordneteKostenZeile[] = [];
  const { token, zentralesKonto } = metaKonfig();

  // 1. Zentrales Meta-Konto: nur zugeordnete Kampagnen
  const zentralNoetig = zuordnungen.some(
    (z) => z.plattform === "meta" && z.aktiv && fuerFirma(z) && (!z.werbekonto_id || z.werbekonto_id === zentralesKonto),
  );
  if (zentralNoetig) {
    if (!token || !zentralesKonto) {
      ergebnis.fehler.push("META_ACCESS_TOKEN oder META_AD_ACCOUNT_ID fehlt");
    } else {
      try {
        const zeilen = metaZeilen(await ladeKampagnenInsights({ since, until }));
        const { zugeordnet, ohneFirma } = ordneZu(zeilen, zuordnungen, null);
        alle.push(...zugeordnet.filter(fuerFirma));
        ergebnis.ohneFirma = ohneFirma;
        ergebnis.konten++;
      } catch (err) {
        ergebnis.fehler.push(`Zentrales Konto: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 2. Eigene Werbekonten: alle Kampagnen des Kontos gehören der Firma
  for (const konto of konten) {
    if (konto.werbekonto_id === zentralesKonto) continue; // zentrales Konto nie komplett einer Firma geben
    try {
      const zeilen = metaZeilen(await ladeKampagnenInsights({ werbekonto: konto.werbekonto_id, since, until }));
      const { zugeordnet } = ordneZu(zeilen, zuordnungen, konto.company_id);
      alle.push(...zugeordnet);
      ergebnis.konten++;

      // Neue Kampagnen des Kontos sichtbar machen (bestehende Zuordnungen bleiben unangetastet)
      const bekannt = new Set(zuordnungen.filter((z) => z.plattform === "meta").map((z) => z.kampagne_id));
      const neu = new Map<string, string | null>();
      for (const z of zeilen) if (!bekannt.has(z.kampagne_id)) neu.set(z.kampagne_id, z.kampagne_name);
      if (neu.size > 0) {
        const { error } = await db.from("kampagnen_zuordnung").upsert(
          [...neu].map(([kampagne_id, kampagne_name]) => ({
            company_id: konto.company_id,
            plattform: "meta",
            kampagne_id,
            kampagne_name,
            werbekonto_id: konto.werbekonto_id,
            aktiv: true,
          })),
          { onConflict: "plattform,kampagne_id", ignoreDuplicates: true },
        );
        if (error) ergebnis.fehler.push(`Zuordnung ${konto.werbekonto_id}: ${error.message}`);
      }
    } catch (err) {
      ergebnis.fehler.push(`${konto.werbekonto_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Google: vorhandene google_ads_insights der zugeordneten Kampagnen übernehmen
  const googleIds = zuordnungen
    .filter((z) => z.plattform === "google" && z.aktiv && fuerFirma(z))
    .map((z) => z.kampagne_id);
  if (googleIds.length > 0) {
    const { data, error } = await db
      .from("google_ads_insights")
      .select("date, campaign_id, campaign_name, spend, impressions, clicks, leads")
      .in("campaign_id", googleIds)
      .gte("date", since)
      .lte("date", until)
      .limit(10_000);
    if (error) {
      ergebnis.fehler.push(`google_ads_insights: ${error.message}`);
    } else {
      const zeilen = fasseZusammen(
        (data ?? []).map((r) => ({
          plattform: "google" as const,
          kampagne_id: String(r.campaign_id),
          kampagne_name: r.campaign_name ?? null,
          datum: String(r.date),
          ausgaben: Number(r.spend) || 0,
          impressionen: Number(r.impressions) || 0,
          klicks: Number(r.clicks) || 0,
          leads_plattform: Number(r.leads) || 0,
        })),
      );
      alle.push(...ordneZu(zeilen, zuordnungen, null).zugeordnet);
    }
  }

  // 4. Speichern
  const zeilen = alle.map((z) => ({
    company_id: z.company_id,
    plattform: z.plattform,
    kampagne_id: z.kampagne_id,
    datum: z.datum,
    ausgaben: z.ausgaben,
    impressionen: z.impressionen,
    klicks: z.klicks,
    leads_plattform: z.leads_plattform,
    aktualisiert_am: now.toISOString(),
  }));
  for (let i = 0; i < zeilen.length; i += BATCH) {
    const { error } = await db
      .from("kampagnen_kosten_tag")
      .upsert(zeilen.slice(i, i + BATCH), { onConflict: "plattform,kampagne_id,datum" });
    if (error) throw new Error(`kampagnen_kosten_tag: ${error.message}`);
  }

  ergebnis.zeilen = zeilen.length;
  ergebnis.firmen = new Set(zeilen.map((z) => z.company_id)).size;
  return ergebnis;
}

/** Wie syncKampagnen, mit Eintrag in sync_log (source „kampagnen“ — getrennt vom Meta-Sync). */
export async function syncKampagnenMitLog(
  db: SupabaseClient,
  opts: { companyId?: string } = {},
): Promise<SyncErgebnis> {
  const { data: log } = await db
    .from("sync_log")
    .insert({ source: "kampagnen", status: "running" })
    .select("id")
    .single();
  try {
    const e = await syncKampagnen(db, opts);
    if (log?.id) {
      await db
        .from("sync_log")
        .update({
          finished_at: new Date().toISOString(),
          records: e.zeilen,
          status: e.fehler.length ? "error" : "success",
          error: e.fehler.length ? e.fehler.join(" | ").slice(0, 2000) : null,
        })
        .eq("id", log.id);
    }
    return e;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (log?.id) {
      await db
        .from("sync_log")
        .update({ finished_at: new Date().toISOString(), status: "error", error: message })
        .eq("id", log.id);
    }
    throw err;
  }
}
