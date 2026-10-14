import type { SupabaseClient } from "@supabase/supabase-js";
import { closeApi, closeUserName, type CloseUser } from "@/lib/integrations/close";
import { NAMEN, PROTOKOLL, rolleVon } from "@/lib/close-team";
import { artAusCalendly } from "@/lib/whatsapp/logik";
import {
  istAuswertbar,
  istWichtig,
  OPENING_MIN_SEK,
  vorlaeufigePhase,
  zahlAusEnv,
  type CloseCall,
  type PhasenKontext,
} from "./logik";

/**
 * Close-Telefonate der letzten 2 Tage → Tabelle gespraeche (idempotent, nur neue Calls).
 * Alle angenommenen Calls mit Aufnahme ≥ 15 s werden für die Statistik gespeichert;
 * hochgeladen werden nur Setting- und Closing-Calls, der Rest ist „uebersprungen“.
 * Close wird nur gelesen.
 */

const SYNC_TAGE = 2;
const TAG_MS = 24 * 60 * 60_000;

export const openingMinSek = () => zahlAusEnv(process.env.FIREFLIES_OPENING_MIN_SEK, OPENING_MIN_SEK);

async function alleSeiten<T>(pfad: string, params: Record<string, string>): Promise<T[]> {
  const ergebnis: T[] = [];
  for (let skip = 0; skip < 10_000; skip += 100) {
    const r = await closeApi<{ data: T[]; has_more: boolean }>(pfad, {
      params: { ...params, _limit: "100", _skip: String(skip) },
      signal: AbortSignal.timeout(20_000),
    });
    ergebnis.push(...r.data);
    if (!r.has_more) break;
  }
  return ergebnis;
}

interface LeadInfo {
  name: string | null;
  emails: string[];
}

async function ladeLead(leadId: string): Promise<LeadInfo> {
  try {
    const l = await closeApi<{ display_name?: string; contacts?: Array<{ emails?: Array<{ email: string }> }> }>(`/lead/${leadId}/`, {
      params: { _fields: "display_name,contacts" },
      signal: AbortSignal.timeout(10_000),
    });
    const emails = (l.contacts ?? []).flatMap((c) => (c.emails ?? []).map((e) => e.email.trim().toLowerCase()));
    return { name: l.display_name ?? null, emails };
  } catch {
    return { name: null, emails: [] };
  }
}

/** Neue Calls aus Close übernehmen. Gibt die Anzahl neuer und davon wichtiger Calls zurück. */
export async function synchronisiereAnrufe(svc: SupabaseClient, jetzt = new Date()): Promise<{ neu: number; wichtig: number }> {
  const seit = new Date(jetzt.getTime() - SYNC_TAGE * TAG_MS);
  const calls = (
    await alleSeiten<CloseCall>("/activity/call/", {
      date_created__gte: seit.toISOString(),
      _fields: "id,lead_id,user_id,direction,disposition,duration,has_recording,recording_url,date_created",
    })
  ).filter(istAuswertbar);
  if (!calls.length) return { neu: 0, wichtig: 0 };

  // Schon bekannte Calls auslassen (in Blöcken wegen URL-Länge)
  const bekannt = new Set<string>();
  for (let i = 0; i < calls.length; i += 100) {
    const { data, error } = await svc.from("gespraeche").select("call_id").in("call_id", calls.slice(i, i + 100).map((c) => c.id));
    if (error) throw new Error(`Gespräche nicht lesbar: ${error.message}`);
    for (const r of (data ?? []) as Array<{ call_id: string }>) bekannt.add(r.call_id);
  }
  const neue = calls.filter((c) => !bekannt.has(c.id));
  if (!neue.length) return { neu: 0, wichtig: 0 };

  const users = await alleSeiten<CloseUser>("/user/", {});
  const name = new Map(users.map((u) => [u.id, NAMEN[u.id] ?? closeUserName(u)]));

  // Kontext für Hendriks Calls: Termine (Terminbot + Calendly) und Setting-/Closing-Protokolle
  const hendrik = neue.filter((c) => rolleVon(c.user_id) === "hendrik" && c.lead_id);
  const leadIds = [...new Set(neue.map((c) => c.lead_id).filter((x): x is string => !!x))];
  const leads = new Map<string, LeadInfo>();
  for (const id of leadIds) leads.set(id, await ladeLead(id));

  let protokolle: Array<{ lead_id: string; custom_activity_type_id: string; date_created: string }> = [];
  let waTermine: Array<{ art: string; start_at: string; close_lead_id: string | null }> = [];
  let calendly: Array<{ event_type_name: string | null; scheduled_at: string; invitee_email: string | null }> = [];
  if (hendrik.length) {
    const von = new Date(seit.getTime() - TAG_MS).toISOString();
    const bis = new Date(jetzt.getTime() + TAG_MS).toISOString();
    protokolle = await alleSeiten("/activity/custom/", { date_created__gte: von, _fields: "lead_id,custom_activity_type_id,date_created" });
    const hLeads = [...new Set(hendrik.map((c) => c.lead_id!))];
    const [wa, cal] = await Promise.all([
      svc.from("wa_termine").select("art, start_at, close_lead_id").in("close_lead_id", hLeads).neq("status", "abgesagt").gte("start_at", von).lte("start_at", bis),
      svc.from("calendly_events").select("event_type_name, scheduled_at, invitee_email").eq("status", "active").gte("scheduled_at", von).lte("scheduled_at", bis),
    ]);
    waTermine = (wa.data ?? []) as typeof waTermine;
    calendly = (cal.data ?? []) as typeof calendly;
  }
  const alsPhase = (art: string | null) => (art === "erstgespraech" ? "setting" : art === "strategie" ? "closing" : null);

  const minSek = openingMinSek();
  const zeilen = neue.map((c) => {
    const lead = c.lead_id ? leads.get(c.lead_id) : undefined;
    const termine: PhasenKontext["termine"] = [];
    const prot: PhasenKontext["protokolle"] = [];
    if (c.lead_id) {
      for (const t of waTermine.filter((x) => x.close_lead_id === c.lead_id)) {
        const art = alsPhase(t.art);
        if (art) termine.push({ art, start: new Date(t.start_at) });
      }
      for (const e of calendly.filter((x) => x.invitee_email && lead?.emails.includes(x.invitee_email.trim().toLowerCase()))) {
        const art = alsPhase(artAusCalendly(e.event_type_name));
        if (art) termine.push({ art, start: new Date(e.scheduled_at) });
      }
      for (const p of protokolle.filter((x) => x.lead_id === c.lead_id)) {
        const art = p.custom_activity_type_id === PROTOKOLL.setting ? "setting" : p.custom_activity_type_id === PROTOKOLL.closing ? "closing" : null;
        if (art) prot.push({ art, datum: new Date(p.date_created) });
      }
    }
    const { phase, grund } = vorlaeufigePhase({ rolle: rolleVon(c.user_id), zeit: new Date(c.date_created), termine, protokolle: prot });
    const w = istWichtig({ phase, dauer_sek: c.duration }, minSek);
    return {
      call_id: c.id,
      lead_id: c.lead_id,
      lead_name: lead?.name ?? null,
      user_id: c.user_id,
      user_name: c.user_id ? name.get(c.user_id) ?? "Unbekannt" : "Unbekannt",
      richtung: c.direction,
      datum: c.date_created,
      dauer_sek: c.duration,
      disposition: c.disposition,
      aufnahme_url: c.recording_url,
      phase,
      phase_grund: grund,
      status: w.wichtig ? "neu" : "uebersprungen",
      fehler: w.wichtig ? null : w.grund,
    };
  });

  const { error } = await svc.from("gespraeche").upsert(zeilen, { onConflict: "call_id", ignoreDuplicates: true });
  if (error) throw new Error(`Gespräche nicht gespeichert: ${error.message}`);
  return { neu: zeilen.length, wichtig: zeilen.filter((z) => z.status === "neu").length };
}

/** Kurzlebiger Download-Link der Aufnahme: Close leitet auf einen signierten Speicher-Link um (Location ohne Folgen holen) */
export async function aufnahmeLink(aufnahmeUrl: string): Promise<string> {
  const key = process.env.CLOSE_API_KEY;
  if (!key) throw new Error("CLOSE_API_KEY fehlt");
  const res = await fetch(aufnahmeUrl, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const ziel = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && ziel) return ziel;
  throw new Error(`Aufnahme-Link nicht verfügbar (${res.status})`);
}
