import type { createAdminClient } from "@/lib/supabase/admin";
import { tabelleFehlt } from "@/lib/auswertung/erfassung";
import { STUFEN } from "@/lib/crm/logik";
import type { FeedRueckruf, FeedTermin, FeedTerminArt } from "./logik";

/**
 * Datenzugriff für „Kalender verbinden“ (Tabelle kalender_abos, Migration 00019).
 * Immer mit dem Service-Client und IMMER auf company_id gefiltert. Fehlt die Tabelle,
 * liefern die Funktionen { fehlt: true } statt zu werfen (Seite zeigt „Wird eingerichtet“).
 */

type Db = ReturnType<typeof createAdminClient>;

export interface KalenderAbo {
  token: string | null;
  token_erzeugt_am: string | null;
  letzter_abruf_am: string | null;
  abrufe: number;
  buchungslink: string | null;
}

export async function ladeKalenderAbo(db: Db, companyId: string): Promise<{ fehlt: boolean; abo: KalenderAbo | null }> {
  const { data, error } = await db
    .from("kalender_abos")
    .select("token, token_erzeugt_am, letzter_abruf_am, abrufe, buchungslink")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    if (!tabelleFehlt(error)) console.warn(`[kalender] Abo lesen: ${error.message}`);
    return { fehlt: true, abo: null };
  }
  return { fehlt: false, abo: (data as KalenderAbo | null) ?? null };
}

/** Nur der Buchungslink (für die Lead-Detailseite) — null, wenn keiner da oder Tabelle fehlt. */
export async function ladeBuchungslink(db: Db, companyId: string): Promise<string | null> {
  const { data, error } = await db.from("kalender_abos").select("buchungslink").eq("company_id", companyId).maybeSingle();
  if (error || !data) return null;
  return (data as { buchungslink: string | null }).buchungslink ?? null;
}

/** Abo per Token finden (öffentliche ICS-Route). */
export async function aboPerToken(db: Db, token: string): Promise<{ companyId: string; token: string; letzterAbruf: string | null; abrufe: number } | null> {
  const { data, error } = await db
    .from("kalender_abos")
    .select("company_id, token, letzter_abruf_am, abrufe")
    .eq("token", token)
    .maybeSingle();
  if (error || !data) return null;
  const z = data as { company_id: string; token: string | null; letzter_abruf_am: string | null; abrufe: number | null };
  if (!z.token) return null;
  return { companyId: z.company_id, token: z.token, letzterAbruf: z.letzter_abruf_am, abrufe: z.abrufe ?? 0 };
}

const TAG = 24 * 60 * 60_000;
const ABSCHLUSS_STATUS = STUFEN.filter((s) => s.abschluss).flatMap((s) => s.status);

interface LeadZeile {
  id: string;
  vorname: string | null;
  nachname: string | null;
  telefon: string | null;
  anliegen: string | null;
}

const nameVon = (l: LeadZeile | undefined) => (l ? `${l.vorname ?? ""} ${l.nachname ?? ""}`.trim() : "");

/** Termine (letzte 60 Tage + Zukunft) und offene Rückrufe (ab 7 Tagen zurück) einer Firma. */
export async function ladeFeedDaten(db: Db, companyId: string, jetzt = new Date()): Promise<{ termine: FeedTermin[]; rueckrufe: FeedRueckruf[] }> {
  const [termineRes, rueckrufRes] = await Promise.all([
    db
      .from("lead_termine")
      .select("id, lead_id, art, beginn, status, updated_at")
      .eq("company_id", companyId)
      .gte("beginn", new Date(jetzt.getTime() - 60 * TAG).toISOString())
      .order("beginn", { ascending: true })
      .limit(1000),
    db
      .from("leads")
      .select("id, vorname, nachname, telefon, anliegen, naechste_aktion_am")
      .eq("company_id", companyId)
      .eq("ist_test", false)
      .not("status", "in", `(${ABSCHLUSS_STATUS.join(",")})`)
      .gte("naechste_aktion_am", new Date(jetzt.getTime() - 7 * TAG).toISOString())
      .order("naechste_aktion_am", { ascending: true })
      .limit(500),
  ]);

  const termineRoh = termineRes.error
    ? []
    : ((termineRes.data ?? []) as { id: string; lead_id: string; art: FeedTerminArt; beginn: string; status: string; updated_at: string | null }[]);
  const rueckrufRoh = rueckrufRes.error ? [] : ((rueckrufRes.data ?? []) as (LeadZeile & { naechste_aktion_am: string })[]);

  // Leads zu den Terminen: nur Leads derselben Firma (Kind-Tabelle über den Elternteil absichern)
  const leadIds = [...new Set(termineRoh.map((t) => t.lead_id))];
  const leads = new Map<string, LeadZeile>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data } = await db
      .from("leads")
      .select("id, vorname, nachname, telefon, anliegen")
      .eq("company_id", companyId)
      .in("id", leadIds.slice(i, i + 200));
    for (const l of (data ?? []) as LeadZeile[]) leads.set(l.id, l);
  }

  const termine: FeedTermin[] = termineRoh
    .filter((t) => leads.has(t.lead_id))
    .map((t) => {
      const l = leads.get(t.lead_id);
      return {
        id: t.id,
        leadId: t.lead_id,
        art: t.art,
        beginn: t.beginn,
        status: t.status,
        name: nameVon(l),
        telefon: l?.telefon ?? null,
        anliegen: l?.anliegen ?? null,
        geaendert: t.updated_at,
      };
    });

  const rueckrufe: FeedRueckruf[] = rueckrufRoh.map((l) => ({
    leadId: l.id,
    am: l.naechste_aktion_am,
    name: nameVon(l),
    telefon: l.telefon,
    anliegen: l.anliegen,
  }));

  return { termine, rueckrufe };
}
