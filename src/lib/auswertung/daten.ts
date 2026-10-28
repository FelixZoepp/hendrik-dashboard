import type { createAdminClient } from "@/lib/supabase/admin";
import type { LeadQuelle, LeadStatus, VerlustGrund } from "@/lib/types/database";
import { berechneTermine, type AAnruf, type ALead, type ATermin } from "@/lib/auswertung/logik";
import { tabelleFehlt } from "@/lib/auswertung/erfassung";

/**
 * Lesen für die Auswertung (Kundenseite: immer mit companyId; Team: companyId = null → alle Firmen).
 * Die Aufrufer prüfen vorher requireKunde() bzw. requireTeam().
 */

type Db = ReturnType<typeof createAdminClient>;

const SEITE = 1000;
const MAX_SEITEN = 50;
/** Anrufe/Termine dürfen minimal vor dem Lead liegen (von Hand nachgetragene Anfragen). */
const VORLAUF_MS = 24 * 60 * 60_000;

async function alleSeiten<T>(
  abfrage: (von: number, bis: number) => PromiseLike<{ data: unknown[] | null; error: { code?: string; message: string } | null }>,
): Promise<{ rows: T[]; error: { code?: string; message: string } | null }> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_SEITEN; i++) {
    const { data, error } = await abfrage(i * SEITE, (i + 1) * SEITE - 1);
    if (error) return { rows, error };
    const teil = (data ?? []) as T[];
    rows.push(...teil);
    if (teil.length < SEITE) break;
  }
  return { rows, error: null };
}

interface LeadRow {
  id: string;
  company_id: string;
  created_at: string;
  status: LeadStatus;
  quelle: LeadQuelle;
  campaign: string | null;
  kampagne_id: string | null;
  first_contact_at: string | null;
  angebotswert: number | null;
  auftragswert: number | null;
  verlust_grund: VerlustGrund | null;
  vorname: string | null;
  nachname: string | null;
  telefon: string | null;
  lead_activities: Array<{ neu_status: LeadStatus | null; created_at: string }> | null;
}

export interface AuswertungsDaten {
  leads: ALead[];
  anrufe: AAnruf[];
  termine: ATermin[];
  /** Migration 00018 fehlt noch (lead_anrufe / lead_termine) */
  ohneErfassung: boolean;
  fehler: string | null;
}

export async function ladeAuswertungsDaten(
  db: Db,
  e: { companyId: string | null; von: Date; bis: Date },
): Promise<AuswertungsDaten> {
  const leadsRes = await alleSeiten<LeadRow>((a, b) => {
    let q = db
      .from("leads")
      .select(
        "id, company_id, created_at, status, quelle, campaign, kampagne_id, first_contact_at, angebotswert, auftragswert, verlust_grund, vorname, nachname, telefon, lead_activities(neu_status, created_at)",
      )
      .gte("created_at", e.von.toISOString())
      .lte("created_at", e.bis.toISOString())
      .eq("lead_activities.typ", "status_wechsel");
    if (e.companyId) q = q.eq("company_id", e.companyId);
    return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b);
  });

  const leads: ALead[] = leadsRes.rows.map((r) => ({
    id: r.id,
    company_id: r.company_id,
    created_at: r.created_at,
    status: r.status,
    quelle: r.quelle,
    kampagne: r.campaign?.trim() || r.kampagne_id || null,
    first_contact_at: r.first_contact_at,
    angebotswert: r.angebotswert != null ? Number(r.angebotswert) : null,
    auftragswert: r.auftragswert != null ? Number(r.auftragswert) : null,
    verlust_grund: r.verlust_grund,
    wechsel: (r.lead_activities ?? []).map((w) => ({ am: w.created_at, neu_status: w.neu_status })),
    name: `${r.vorname ?? ""} ${r.nachname ?? ""}`.trim() || "Ohne Namen",
    telefon: r.telefon,
  }));

  if (leads.length === 0 || leadsRes.error) {
    return { leads, anrufe: [], termine: [], ohneErfassung: false, fehler: leadsRes.error?.message ?? null };
  }

  const ab = new Date(e.von.getTime() - VORLAUF_MS).toISOString();
  const [anrufRes, terminRes] = await Promise.all([
    alleSeiten<AAnruf>((a, b) => {
      let q = db.from("lead_anrufe").select("lead_id, am, kanal, ergebnis").gte("am", ab);
      if (e.companyId) q = q.eq("company_id", e.companyId);
      return q.order("am", { ascending: true }).order("id", { ascending: true }).range(a, b);
    }),
    alleSeiten<ATermin>((a, b) => {
      let q = db
        .from("lead_termine")
        .select("id, lead_id, art, beginn, status, ersetzt_termin_id, created_at")
        .gte("created_at", ab);
      if (e.companyId) q = q.eq("company_id", e.companyId);
      return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b);
    }),
  ]);

  const ohneErfassung = tabelleFehlt(anrufRes.error) || tabelleFehlt(terminRes.error);
  const fehler = [anrufRes.error, terminRes.error].find((x) => x && !tabelleFehlt(x))?.message ?? null;
  const ids = new Set(leads.map((l) => l.id));
  return {
    leads,
    anrufe: anrufRes.error ? [] : anrufRes.rows.filter((a) => ids.has(a.lead_id)),
    termine: terminRes.error ? [] : terminRes.rows.filter((t) => ids.has(t.lead_id)),
    ohneErfassung,
    fehler,
  };
}

export interface TerminAufgabe {
  terminId: string;
  leadId: string;
  beginn: string;
  art: ATermin["art"];
  name: string;
  telefon: string | null;
}

/**
 * Für die Startseite: Termine ohne Rückmeldung („Wie war der Termin?“) und
 * No-Shows ohne neuen Termin („No-Show zurückholen“) — unabhängig vom Zeitraum (letzte 120 Tage).
 */
export async function ladeTerminAufgaben(
  db: Db,
  companyId: string,
  jetzt: Date = new Date(),
): Promise<{ wartend: TerminAufgabe[]; noShows: TerminAufgabe[] }> {
  const ab = new Date(jetzt.getTime() - 120 * VORLAUF_MS).toISOString();
  const { data, error } = await db
    .from("lead_termine")
    .select("id, lead_id, art, beginn, status, ersetzt_termin_id, created_at")
    .eq("company_id", companyId)
    .gte("created_at", ab)
    .order("beginn", { ascending: true })
    .limit(1000);
  if (error || !data || data.length === 0) return { wartend: [], noShows: [] };
  const termine = data as ATermin[];

  const leadIds = [...new Set(termine.map((t) => t.lead_id))].slice(0, 300);
  const { data: leadRows } = await db
    .from("leads")
    .select("id, status, vorname, nachname, telefon, created_at")
    .eq("company_id", companyId)
    .in("id", leadIds);
  const leads = new Map(
    ((leadRows ?? []) as Array<{ id: string; status: LeadStatus; vorname: string | null; nachname: string | null; telefon: string | null; created_at: string }>).map(
      (l) => [l.id, l],
    ),
  );
  const aLeads: ALead[] = [...leads.values()].map((l) => ({
    id: l.id,
    created_at: l.created_at,
    status: l.status,
    quelle: "manuell",
    kampagne: null,
    first_contact_at: null,
    angebotswert: null,
    auftragswert: null,
    verlust_grund: null,
    wechsel: [],
  }));
  const erg = berechneTermine(termine, aLeads, jetzt);
  const byId = new Map(termine.map((t) => [t.id, t]));
  const aufgabe = (x: { terminId: string; leadId: string; beginn: string }): TerminAufgabe => {
    const l = leads.get(x.leadId);
    return {
      ...x,
      art: byId.get(x.terminId)?.art ?? "vor_ort",
      name: l ? `${l.vorname ?? ""} ${l.nachname ?? ""}`.trim() || "Ohne Namen" : "Anfrage",
      telefon: l?.telefon ?? null,
    };
  };
  // Nur abgeschlossene Leads raus (berechneTermine prüft das für No-Shows schon)
  const wartend = erg.wartend.filter((w) => {
    const s = leads.get(w.leadId)?.status;
    return s && s !== "gewonnen" && !["verloren", "kein_interesse", "nicht_erreicht"].includes(s);
  });
  return { wartend: wartend.map(aufgabe), noShows: erg.offeneNoShows.map(aufgabe) };
}
