/**
 * Kampagnen-Zahlen einer Firma laden (Service-Rolle, IMMER mit company_id gefiltert).
 * Genutzt von /kampagne, /kampagne/bericht und <KampagnenKarte />.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  berechneKennzahlen,
  istWerbeLead,
  manuellerAnteil,
  manuelleTageswerte,
  summeAusgaben,
  wochenVerlauf,
  zaehleLeads,
  type Kennzahlen,
  type LeadZeile,
  type ManuelleKosten,
  type Plattform,
  type WochenPunkt,
  type Zeitraum,
} from "./logik";

interface KostenTagZeile {
  plattform: Plattform;
  kampagne_id: string;
  datum: string;
  ausgaben: number | string;
  impressionen: number;
  klicks: number;
  leads_plattform: number;
  aktualisiert_am: string | null;
}

export interface KampagnenZeile {
  plattform: Plattform | "manuell";
  kampagneId: string | null;
  name: string;
  ausgaben: number;
  leads: number;
  leadsPlattform: number;
}

export interface KampagnenBericht {
  kennzahlen: Kennzahlen;
  verlauf: WochenPunkt[];
  kampagnen: KampagnenZeile[];
  manuellSumme: number;
  letzterAbgleich: string | null;
  /** Tabellen aus 00017 fehlen noch (Migration nicht eingespielt) */
  einrichtungFehlt: boolean;
}

type LeadMitKampagne = LeadZeile & { kampagne_id?: string | null };

const fehltTabelle = (msg: string) => /does not exist|schema cache|relation .* not exist|Could not find the table/i.test(msg);

async function ladeLeads(db: SupabaseClient, companyId: string, z: Zeitraum): Promise<LeadMitKampagne[]> {
  const abfrage = (spalten: string) => () =>
    db
      .from("leads")
      .select(spalten, { count: "exact" })
      .eq("company_id", companyId)
      .gte("created_at", z.start.toISOString())
      .lt("created_at", z.ende.toISOString())
      .order("id");
  try {
    return await fetchAll<LeadMitKampagne>(abfrage("status, quelle, auftragswert, angebotswert, created_at, kampagne_id"));
  } catch {
    // kampagne_id kommt erst mit 00014
    return fetchAll<LeadMitKampagne>(abfrage("status, quelle, auftragswert, angebotswert, created_at"));
  }
}

export async function ladeKampagnenBericht(
  db: SupabaseClient,
  companyId: string,
  z: Zeitraum,
): Promise<KampagnenBericht> {
  let einrichtungFehlt = false;
  const sicher = async <T>(f: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await f();
    } catch (err) {
      if (fehltTabelle(err instanceof Error ? err.message : String(err))) {
        einrichtungFehlt = true;
        return [];
      }
      throw err;
    }
  };

  const [leads, kosten, manuell, zuordnungen] = await Promise.all([
    ladeLeads(db, companyId, z),
    sicher(() =>
      fetchAll<KostenTagZeile>(() =>
        db
          .from("kampagnen_kosten_tag")
          .select("plattform, kampagne_id, datum, ausgaben, impressionen, klicks, leads_plattform, aktualisiert_am", {
            count: "exact",
          })
          .eq("company_id", companyId)
          .gte("datum", z.vonDatum)
          .lte("datum", z.bisDatum)
          .order("id"),
      ),
    ),
    sicher(async () => {
      const { data, error } = await db
        .from("manuelle_kosten")
        .select("monat, betrag, notiz")
        .eq("company_id", companyId)
        .gte("monat", `${z.vonDatum.slice(0, 7)}-01`)
        .lte("monat", z.bisDatum);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<ManuelleKosten & { notiz: string | null }>;
    }),
    sicher(async () => {
      const { data, error } = await db
        .from("kampagnen_zuordnung")
        .select("plattform, kampagne_id, kampagne_name")
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ plattform: Plattform; kampagne_id: string; kampagne_name: string | null }>;
    }),
  ]);

  const ausgaben = summeAusgaben(kosten, manuell, z.vonDatum, z.bisDatum);
  const kennzahlen = berechneKennzahlen(ausgaben, zaehleLeads(leads));

  // Manuelle Kosten im Verlauf: gleichmäßig auf die Tage des Monats verteilt
  const verlauf = wochenVerlauf(
    leads,
    [...kosten, ...manuelleTageswerte(manuell, z.vonDatum, z.bisDatum)],
    z.vonDatum,
    z.bisDatum,
  );

  // Aufschlüsselung je Kampagne
  const namen = new Map(zuordnungen.map((k) => [`${k.plattform}|${k.kampagne_id}`, k.kampagne_name]));
  const proKampagne = new Map<string, KampagnenZeile>();
  for (const k of kosten) {
    const key = `${k.plattform}|${k.kampagne_id}`;
    const v =
      proKampagne.get(key) ??
      ({
        plattform: k.plattform,
        kampagneId: k.kampagne_id,
        name: namen.get(key) || `Kampagne ${k.kampagne_id}`,
        ausgaben: 0,
        leads: 0,
        leadsPlattform: 0,
      } satisfies KampagnenZeile);
    v.ausgaben += Number(k.ausgaben) || 0;
    v.leadsPlattform += k.leads_plattform || 0;
    proKampagne.set(key, v);
  }
  const nachId = new Map([...proKampagne.values()].map((k) => [k.kampagneId, k]));
  for (const l of leads) {
    if (!istWerbeLead(l) || !l.kampagne_id) continue;
    const treffer = nachId.get(l.kampagne_id);
    if (treffer) treffer.leads++;
  }
  const manuellSumme = manuell.reduce((s, m) => s + manuellerAnteil(m, z.vonDatum, z.bisDatum), 0);
  const kampagnen = [...proKampagne.values()].sort((a, b) => b.ausgaben - a.ausgaben);
  if (manuellSumme > 0) {
    kampagnen.push({ plattform: "manuell", kampagneId: null, name: "Weitere Kosten (manuell)", ausgaben: manuellSumme, leads: 0, leadsPlattform: 0 });
  }

  const letzterAbgleich = kosten.reduce<string | null>(
    (m, k) => (k.aktualisiert_am && (!m || k.aktualisiert_am > m) ? k.aktualisiert_am : m),
    null,
  );

  return { kennzahlen, verlauf, kampagnen, manuellSumme, letzterAbgleich, einrichtungFehlt };
}
