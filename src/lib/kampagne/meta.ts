/**
 * Nur lesende Meta-Graph-Aufrufe für Kampagnen je Kunde (GET).
 * Der bestehende Sync (src/lib/integrations/meta.ts → meta_ad_insights) bleibt unberührt.
 */
import type { KontoKampagne, MetaKampagnenInsight } from "./logik";

const GRAPH_API = "https://graph.facebook.com/v21.0";

export function metaKonfig(): { token: string; zentralesKonto: string } {
  return {
    token: process.env.META_ACCESS_TOKEN || "",
    zentralesKonto: process.env.META_AD_ACCOUNT_ID || "",
  };
}

export function metaBereit(): boolean {
  const k = metaKonfig();
  return !!k.token && !!k.zentralesKonto;
}

async function holeAlleSeiten<T>(ersteUrl: string, maxSeiten = 50): Promise<T[]> {
  const alle: T[] = [];
  let url: string | null = ersteUrl;
  for (let s = 0; url && s < maxSeiten; s++) {
    const res: Response = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      // Token nicht in Fehlermeldungen durchreichen
      throw new Error(`Meta API ${res.status}: ${text.slice(0, 300)}`);
    }
    const data: { data?: T[]; paging?: { next?: string } } = await res.json();
    alle.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return alle;
}

/** Kampagnen eines Werbekontos (id, name, status) — für die Auswahl im Team-Bereich. */
export async function ladeKontoKampagnen(werbekonto?: string): Promise<KontoKampagne[]> {
  const { token, zentralesKonto } = metaKonfig();
  const konto = werbekonto || zentralesKonto;
  if (!token || !konto) throw new Error("META_ACCESS_TOKEN oder META_AD_ACCOUNT_ID fehlt");
  const params = new URLSearchParams({
    access_token: token,
    fields: "id,name,status",
    limit: "200",
  });
  const rows = await holeAlleSeiten<{ id: string; name?: string; status?: string }>(
    `${GRAPH_API}/${konto}/campaigns?${params.toString()}`,
    20,
  );
  return rows.map((r) => ({ id: String(r.id), name: r.name ?? r.id, status: r.status ?? null }));
}

/** Tageswerte je Kampagne (level=campaign, time_increment=1). */
export async function ladeKampagnenInsights(opts: {
  werbekonto?: string;
  since: string;
  until: string;
}): Promise<MetaKampagnenInsight[]> {
  const { token, zentralesKonto } = metaKonfig();
  const konto = opts.werbekonto || zentralesKonto;
  if (!token || !konto) throw new Error("META_ACCESS_TOKEN oder META_AD_ACCOUNT_ID fehlt");
  const params = new URLSearchParams({
    access_token: token,
    level: "campaign",
    fields: "campaign_id,campaign_name,spend,impressions,clicks,actions",
    time_range: JSON.stringify({ since: opts.since, until: opts.until }),
    time_increment: "1",
    limit: "500",
  });
  return holeAlleSeiten<MetaKampagnenInsight>(`${GRAPH_API}/${konto}/insights?${params.toString()}`);
}
