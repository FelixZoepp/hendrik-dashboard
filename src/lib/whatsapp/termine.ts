import type { SupabaseClient } from "@supabase/supabase-js";
import {
  istGleicherTermin,
  planeZeitplan,
  zufallsToken,
  zusammenfuehren,
  ZUSAMMENFUEHREN_FENSTER_MS,
  type JobTyp,
  type TerminArt,
  type TerminDaten,
} from "./logik";

/**
 * Termine des WhatsApp-Terminbots: anlegen, zusammenführen (Calendly + Close),
 * Zeitplan der Jobs, Absage/No-Show/Stattgefunden.
 */

export interface Termin {
  id: string;
  token: string;
  art: TerminArt;
  quelle: "calendly" | "close";
  calendly_event_uri: string | null;
  calendly_invitee_uri: string | null;
  reschedule_url: string | null;
  cancel_url: string | null;
  join_url: string | null;
  ort_text: string | null;
  close_lead_id: string | null;
  close_opp_id: string | null;
  close_protokoll_id: string | null;
  close_user_id: string | null;
  gastgeber_name: string | null;
  vorname: string | null;
  name: string | null;
  firma: string | null;
  telefon: string | null;
  email: string | null;
  start_at: string;
  ende_at: string | null;
  status: "geplant" | "abgesagt" | "stattgefunden" | "verpasst";
  opt_in: boolean;
  bestaetigt_am: string | null;
  verschieben_am: string | null;
  created_at: string;
  updated_at: string;
}

export type TerminEingabe = TerminDaten;

/** Jobs, die aus dem Zeitplan kommen (verpasst/abgesagt entstehen nur durch Ereignisse). */
const PLAN_TYPEN: JobTyp[] = ["gebucht", "erinnerung", "unbestaetigt_check", "gleich"];

export interface AnlegeErgebnis {
  termin: Termin;
  aktion: "neu" | "zusammengefuehrt" | "unveraendert" | "inaktiv";
  startGeaendert: boolean;
}

/** Termin anlegen oder mit einem bestehenden zusammenführen; plant bzw. aktualisiert die Jobs. */
export async function legeTerminAn(
  svc: SupabaseClient,
  eingabe: TerminEingabe,
  jetzt: Date = new Date(),
): Promise<AnlegeErgebnis> {
  const bestehend = await findeBestehenden(svc, eingabe);

  if (bestehend) {
    // Abgesagte/abgeschlossene Termine nicht wiederbeleben (z. B. verspätete Webhook-Wiederholung)
    if (bestehend.status !== "geplant") return { termin: bestehend, aktion: "inaktiv", startGeaendert: false };

    const { patch, startGeaendert } = zusammenfuehren(bestehend as unknown as TerminDaten, eingabe);
    if (Object.keys(patch).length === 0) {
      await planeJobs(svc, bestehend, jetzt, false);
      return { termin: bestehend, aktion: "unveraendert", startGeaendert: false };
    }
    const update: Record<string, unknown> = { ...patch };
    if (startGeaendert) {
      update.bestaetigt_am = null;
      update.verschieben_am = null;
    }
    const { data, error } = await svc.from("wa_termine").update(update).eq("id", bestehend.id).select("*").single();
    if (error || !data) throw new Error(`Termin nicht aktualisiert: ${error?.message}`);
    const termin = data as Termin;
    await planeJobs(svc, termin, jetzt, startGeaendert);
    return { termin, aktion: "zusammengefuehrt", startGeaendert };
  }

  const zeile: Record<string, unknown> = { status: "geplant", opt_in: eingabe.opt_in ?? false };
  for (const [k, v] of Object.entries(eingabe)) if (v !== undefined && k !== "opt_in") zeile[k] = v;

  for (let versuch = 0; versuch < 3; versuch++) {
    const { data, error } = await svc
      .from("wa_termine")
      .insert({ ...zeile, token: zufallsToken() })
      .select("*")
      .single();
    if (!error && data) {
      const termin = data as Termin;
      await planeJobs(svc, termin, jetzt, false);
      return { termin, aktion: "neu", startGeaendert: false };
    }
    // 23505: Token-Kollision (sehr unwahrscheinlich) oder parallel angelegte Calendly-Buchung
    if (error?.code === "23505") {
      if (eingabe.calendly_event_uri) {
        const vorhanden = await findeBestehenden(svc, eingabe);
        if (vorhanden) return { termin: vorhanden, aktion: "unveraendert", startGeaendert: false };
      }
      continue;
    }
    throw new Error(`Termin nicht angelegt: ${error?.message}`);
  }
  throw new Error("Termin nicht angelegt: kein freier Token");
}

async function findeBestehenden(svc: SupabaseClient, e: TerminEingabe): Promise<Termin | null> {
  if (e.calendly_event_uri) {
    const { data } = await svc.from("wa_termine").select("*").eq("calendly_event_uri", e.calendly_event_uri).maybeSingle();
    if (data) return data as Termin;
  }
  if (e.close_protokoll_id) {
    const { data } = await svc
      .from("wa_termine")
      .select("*")
      .eq("close_protokoll_id", e.close_protokoll_id)
      .eq("status", "geplant")
      .order("created_at", { ascending: false })
      .limit(1);
    const t = (data as Termin[] | null)?.[0];
    if (t) return t;
  }

  const start = new Date(e.start_at).getTime();
  const { data } = await svc
    .from("wa_termine")
    .select("*")
    .eq("art", e.art)
    .eq("status", "geplant")
    .gte("start_at", new Date(start - ZUSAMMENFUEHREN_FENSTER_MS).toISOString())
    .lte("start_at", new Date(start + ZUSAMMENFUEHREN_FENSTER_MS).toISOString());
  const kandidaten = ((data ?? []) as Termin[]).filter(
    (t) =>
      // Zwei verschiedene Calendly-Buchungen sind nie derselbe Termin
      !(e.calendly_event_uri && t.calendly_event_uri && t.calendly_event_uri !== e.calendly_event_uri) &&
      istGleicherTermin(t as unknown as TerminDaten, e),
  );
  kandidaten.sort(
    (a, b) =>
      Math.abs(new Date(a.start_at).getTime() - start) - Math.abs(new Date(b.start_at).getTime() - start),
  );
  return kandidaten[0] ?? null;
}

/**
 * Jobs nach Zeitplan anlegen. neuPlanen = true (Start verschoben): vorhandene Plan-Jobs
 * werden zurückgesetzt bzw. abgebrochen; sonst nur fehlende ergänzen (keine Doppelten).
 */
export async function planeJobs(svc: SupabaseClient, termin: Termin, jetzt: Date, neuPlanen: boolean): Promise<void> {
  const plan = planeZeitplan(new Date(termin.start_at), jetzt, termin.art);
  const zeilen = plan.map((j) => ({
    termin_id: termin.id,
    typ: j.typ,
    run_at: j.run_at.toISOString(),
    status: "geplant",
    versuche: 0,
    fehler: null,
    ergebnis: null,
    claimed_at: null,
  }));

  if (neuPlanen) {
    const wegfallend = PLAN_TYPEN.filter((t) => !plan.some((p) => p.typ === t));
    if (wegfallend.length) {
      await svc
        .from("wa_jobs")
        .update({ status: "abgebrochen", ergebnis: "Termin verschoben" })
        .eq("termin_id", termin.id)
        .in("typ", wegfallend)
        .in("status", ["geplant", "laeuft"]);
    }
  }
  if (zeilen.length === 0) return;
  const { error } = await svc
    .from("wa_jobs")
    .upsert(zeilen, { onConflict: "termin_id,typ", ignoreDuplicates: !neuPlanen });
  if (error) throw new Error(`Jobs nicht geplant: ${error.message}`);
}

/** Offene Jobs abbrechen (alle oder nur bestimmte Typen). */
export async function brecheJobsAb(
  svc: SupabaseClient,
  terminIds: string[],
  grund: string,
  ausser: JobTyp[] = [],
): Promise<void> {
  if (terminIds.length === 0) return;
  let q = svc
    .from("wa_jobs")
    .update({ status: "abgebrochen", ergebnis: grund })
    .in("termin_id", terminIds)
    .eq("status", "geplant");
  if (ausser.length) q = q.not("typ", "in", `(${ausser.join(",")})`);
  const { error } = await q;
  if (error) throw new Error(`Jobs nicht abgebrochen: ${error.message}`);
}

async function ereignisJob(svc: SupabaseClient, terminId: string, typ: JobTyp, jetzt: Date): Promise<void> {
  const { error } = await svc
    .from("wa_jobs")
    .upsert(
      { termin_id: terminId, typ, run_at: jetzt.toISOString(), status: "geplant" },
      { onConflict: "termin_id,typ", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Job ${typ} nicht geplant: ${error.message}`);
}

/** Absage: Status setzen, offene Jobs abbrechen, optional „abgesagt“-Nachricht planen. */
export async function sagTerminAb(
  svc: SupabaseClient,
  termin: Termin,
  opts: { nachricht: boolean; grund: string; jetzt?: Date },
): Promise<void> {
  const jetzt = opts.jetzt ?? new Date();
  if (termin.status === "abgesagt") return;
  await svc.from("wa_termine").update({ status: "abgesagt" }).eq("id", termin.id);
  await brecheJobsAb(svc, [termin.id], opts.grund);
  if (opts.nachricht && new Date(termin.start_at).getTime() > jetzt.getTime()) {
    await ereignisJob(svc, termin.id, "abgesagt", jetzt);
  }
}

/** No-Show: Status „verpasst“, offene Jobs abbrechen, „verpasst“-Nachricht sofort planen. */
export async function markiereVerpasst(svc: SupabaseClient, termin: Termin, jetzt: Date = new Date()): Promise<void> {
  await svc.from("wa_termine").update({ status: "verpasst" }).eq("id", termin.id);
  await brecheJobsAb(svc, [termin.id], "Termin verpasst");
  await ereignisJob(svc, termin.id, "verpasst", jetzt);
}

/** Gespräch hat stattgefunden (Protokoll in Close): offene Jobs abbrechen. */
export async function markiereStattgefunden(svc: SupabaseClient, termin: Termin): Promise<void> {
  await svc.from("wa_termine").update({ status: "stattgefunden" }).eq("id", termin.id);
  await brecheJobsAb(svc, [termin.id], "Gespräch hat stattgefunden");
}

export async function ladeTerminPerToken(svc: SupabaseClient, token: string): Promise<Termin | null> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(token)) return null;
  const { data } = await svc.from("wa_termine").select("*").eq("token", token).maybeSingle();
  return (data as Termin | null) ?? null;
}

/** Zuletzt begonnener Termin eines Close-Leads (für No-Show/Stattgefunden aus Protokollen). */
export async function letzterTerminDesLeads(
  svc: SupabaseClient,
  leadId: string,
  art: TerminArt,
  jetzt: Date = new Date(),
): Promise<Termin | null> {
  const { data } = await svc
    .from("wa_termine")
    .select("*")
    .eq("close_lead_id", leadId)
    .eq("art", art)
    .eq("status", "geplant")
    .lte("start_at", new Date(jetzt.getTime() + 2 * 60 * 60_000).toISOString())
    .order("start_at", { ascending: false })
    .limit(1);
  return ((data as Termin[] | null) ?? [])[0] ?? null;
}
