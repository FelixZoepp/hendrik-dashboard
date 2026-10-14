import type { SupabaseClient } from "@supabase/supabase-js";
import { fuehreBotLeadZusammen } from "./close-log";
import {
  folgeJobsNachStartaenderung,
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
 *
 * Grundsätze:
 * - Quellen-IDs (calendly_event_uri, close_protokoll_id) werden OHNE Statusfilter gesucht:
 *   abgesagte/erledigte Termine werden nie wiederbelebt.
 * - „gebucht“ wird nie neu geplant; Doppel-Versand verhindert zusätzlich die
 *   Versand-Reservierung in gate.ts.
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
  /** Lead wurde vom Bot aus der Calendly-Buchung angelegt (bis zur Zusammenführung mit dem echten Lead) */
  close_lead_angelegt: boolean;
  close_opp_id: string | null;
  close_protokoll_id: string | null;
  ergebnis_protokoll_id: string | null;
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
  abgesagt_am: string | null;
  created_at: string;
  updated_at: string;
}

export type TerminEingabe = TerminDaten;

export interface AnlegeErgebnis {
  termin: Termin;
  aktion: "neu" | "zusammengefuehrt" | "unveraendert" | "inaktiv";
  startGeaendert: boolean;
}

const alsDaten = (t: Termin) => t as unknown as TerminDaten;

/** Termin anlegen oder mit einem bestehenden zusammenführen; plant bzw. aktualisiert die Jobs. */
export async function legeTerminAn(
  svc: SupabaseClient,
  eingabe: TerminEingabe,
  jetzt: Date = new Date(),
): Promise<AnlegeErgebnis> {
  const treffer = await findeBestehenden(svc, eingabe);
  if (treffer) return fuehreZusammen(svc, treffer.termin, eingabe, treffer.gleicheQuelle, jetzt);

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
      // Gleichzeitige Webhooks (Calendly + Close) → Duplikat suchen und in den älteren Termin legen
      const aelter = await aeltererDoppelgaenger(svc, termin);
      if (aelter) return legeInAelterenZusammen(svc, termin, aelter, eingabe, jetzt);
      await planeJobs(svc, termin, jetzt);
      return { termin, aktion: "neu", startGeaendert: false };
    }
    if (error?.code === "23505") {
      // Parallel angelegt (gleiche Quellen-ID) → bestehenden nehmen; sonst Token-Kollision → neu versuchen
      const vorhanden = await findeBestehenden(svc, eingabe);
      if (vorhanden) return fuehreZusammen(svc, vorhanden.termin, eingabe, vorhanden.gleicheQuelle, jetzt);
      continue;
    }
    throw new Error(`Termin nicht angelegt: ${error?.message}`);
  }
  throw new Error("Termin nicht angelegt: kein freier Token");
}

async function fuehreZusammen(
  svc: SupabaseClient,
  bestehend: Termin,
  eingabe: TerminEingabe,
  gleicheQuelle: boolean,
  jetzt: Date,
): Promise<AnlegeErgebnis> {
  if (bestehend.status !== "geplant") return { termin: bestehend, aktion: "inaktiv", startGeaendert: false };

  const z = zusammenfuehren(alsDaten(bestehend), eingabe, gleicheQuelle);
  // Vom Bot angelegten Close-Lead in den Lead aus dem Protokoll legen — nie blockierend
  const leadMerge = async () => {
    if (z.leadZusammenfuehren) await fuehreBotLeadZusammen(svc, { ...z.leadZusammenfuehren, terminId: bestehend.id });
  };
  if (Object.keys(z.patch).length === 0) {
    await planeJobs(svc, bestehend, jetzt);
    await leadMerge();
    return { termin: bestehend, aktion: "unveraendert", startGeaendert: false };
  }
  const update: Record<string, unknown> = { ...z.patch };
  if (z.bestaetigungZuruecksetzen) {
    update.bestaetigt_am = null;
    update.verschieben_am = null;
  }
  const { data, error } = await svc.from("wa_termine").update(update).eq("id", bestehend.id).select("*").single();
  if (error || !data) throw new Error(`Termin nicht aktualisiert: ${error?.message}`);
  const termin = data as Termin;

  await planeJobs(svc, termin, jetzt);
  if (z.startGeaendert) await rechneFolgeJobsUm(svc, termin, jetzt, z.bestaetigungZuruecksetzen);
  if (z.optInGewonnen) await gebuchtWiederAktivieren(svc, termin, jetzt);
  await leadMerge();
  return { termin, aktion: "zusammengefuehrt", startGeaendert: z.startGeaendert };
}

/** Close-Lead eines schon vorhandenen passenden Termins (vor dem Anlegen eines neuen Leads prüfen). */
export async function leadEinesPassendenTermins(svc: SupabaseClient, e: TerminEingabe): Promise<string | null> {
  const t = await findeBestehenden(svc, e);
  return t?.termin.close_lead_id ?? null;
}

async function findeBestehenden(
  svc: SupabaseClient,
  e: TerminEingabe,
): Promise<{ termin: Termin; gleicheQuelle: boolean } | null> {
  // Quellen-IDs ohne Statusfilter → nie wiederbeleben
  if (e.calendly_event_uri) {
    const { data, error } = await svc.from("wa_termine").select("*").eq("calendly_event_uri", e.calendly_event_uri).maybeSingle();
    if (error) throw new Error(`Terminsuche fehlgeschlagen: ${error.message}`);
    if (data) return { termin: data as Termin, gleicheQuelle: true };
  }
  if (e.close_protokoll_id) {
    const { data, error } = await svc.from("wa_termine").select("*").eq("close_protokoll_id", e.close_protokoll_id).maybeSingle();
    if (error) throw new Error(`Terminsuche fehlgeschlagen: ${error.message}`);
    if (data) return { termin: data as Termin, gleicheQuelle: true };
  }
  const t = await suchePassenden(svc, e, null);
  return t ? { termin: t, gleicheQuelle: false } : null;
}

/** Geplanter Termin desselben Leads (Close-Lead/Telefon/E-Mail), gleiche Art, Start ±30 Min. */
async function suchePassenden(svc: SupabaseClient, e: TerminDaten, ausserId: string | null): Promise<Termin | null> {
  const start = new Date(e.start_at).getTime();
  const { data, error } = await svc
    .from("wa_termine")
    .select("*")
    .eq("art", e.art)
    .eq("status", "geplant")
    .gte("start_at", new Date(start - ZUSAMMENFUEHREN_FENSTER_MS).toISOString())
    .lte("start_at", new Date(start + ZUSAMMENFUEHREN_FENSTER_MS).toISOString())
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Terminsuche fehlgeschlagen: ${error.message}`);
  const kandidaten = ((data ?? []) as Termin[]).filter(
    (t) =>
      t.id !== ausserId &&
      // Zwei verschiedene Buchungen derselben Quelle sind nie derselbe Termin
      !(e.calendly_event_uri && t.calendly_event_uri && t.calendly_event_uri !== e.calendly_event_uri) &&
      !(e.close_protokoll_id && t.close_protokoll_id && t.close_protokoll_id !== e.close_protokoll_id) &&
      istGleicherTermin(alsDaten(t), e),
  );
  return kandidaten[0] ?? null;
}

async function aeltererDoppelgaenger(svc: SupabaseClient, termin: Termin): Promise<Termin | null> {
  const t = await suchePassenden(svc, alsDaten(termin), termin.id);
  return t && t.created_at <= termin.created_at ? t : null;
}

/** Jüngeren (gerade angelegten) Termin ohne Nachricht absagen und seine Daten in den älteren legen. */
async function legeInAelterenZusammen(
  svc: SupabaseClient,
  juenger: Termin,
  aelter: Termin,
  eingabe: TerminEingabe,
  jetzt: Date,
): Promise<AnlegeErgebnis> {
  // Quellen-IDs zuerst freigeben (unique), dann übertragen
  const { error } = await svc
    .from("wa_termine")
    .update({ status: "abgesagt", abgesagt_am: jetzt.toISOString(), calendly_event_uri: null, close_protokoll_id: null })
    .eq("id", juenger.id);
  if (error) throw new Error(`Doppelten Termin nicht zusammengeführt: ${error.message}`);
  await brecheJobsAb(svc, [juenger.id], "Mit älterem Termin zusammengeführt");
  return fuehreZusammen(svc, aelter, eingabe, false, jetzt);
}

/** Fehlende Jobs nach Zeitplan anlegen (vorhandene bleiben unangetastet, keine Doppelten). */
export async function planeJobs(svc: SupabaseClient, termin: Termin, jetzt: Date): Promise<void> {
  const zeilen = planeZeitplan(new Date(termin.start_at), jetzt, termin.art).map((j) => ({
    termin_id: termin.id,
    typ: j.typ,
    run_at: j.run_at.toISOString(),
    faellig_urspruenglich: j.run_at.toISOString(),
    status: "geplant",
  }));
  if (zeilen.length === 0) return;
  const { error } = await svc.from("wa_jobs").upsert(zeilen, { onConflict: "termin_id,typ", ignoreDuplicates: true });
  if (error) throw new Error(`Jobs nicht geplant: ${error.message}`);
}

/**
 * Startänderung: Folge-Jobs (Erinnerung, Nachfassen, gleich) auf den neuen Start umrechnen.
 * Echte Verschiebung: unabhängig vom bisherigen Status (außer 'laeuft') neu planen — der
 * Versand-Schlüssel enthält den Start, die Erinnerung darf also erneut kommen.
 * Kleine Abweichung beim Zusammenführen: nur noch geplante umrechnen. „gebucht“ bleibt.
 */
export async function rechneFolgeJobsUm(
  svc: SupabaseClient,
  termin: Termin,
  jetzt: Date,
  echteVerschiebung: boolean,
): Promise<void> {
  const { data, error } = await svc.from("wa_jobs").select("typ, status").eq("termin_id", termin.id);
  if (error) throw new Error(`Jobs nicht lesbar: ${error.message}`);
  const aktionen = folgeJobsNachStartaenderung(
    (data ?? []) as Array<{ typ: JobTyp; status: string }>,
    planeZeitplan(new Date(termin.start_at), jetzt, termin.art),
    echteVerschiebung,
  );
  for (const a of aktionen) {
    const { error: e } =
      a.aktion === "planen"
        ? await svc.from("wa_jobs").upsert(
            {
              termin_id: termin.id,
              typ: a.typ,
              run_at: a.run_at.toISOString(),
              faellig_urspruenglich: a.run_at.toISOString(),
              status: "geplant",
              versuche: 0,
              fehler: null,
              ergebnis: "Termin verschoben",
              claimed_at: null,
            },
            { onConflict: "termin_id,typ" },
          )
        : await svc
            .from("wa_jobs")
            .update({ status: "abgebrochen", ergebnis: "Termin verschoben" })
            .eq("termin_id", termin.id)
            .eq("typ", a.typ)
            .eq("status", "geplant");
    if (e) throw new Error(`Job ${a.typ} nicht umgerechnet: ${e.message}`);
  }
}

/** Einwilligung kam nachträglich → übersprungene Buchungsnachricht erneut einplanen. */
async function gebuchtWiederAktivieren(svc: SupabaseClient, termin: Termin, jetzt: Date): Promise<void> {
  if (new Date(termin.start_at).getTime() <= jetzt.getTime()) return;
  await svc
    .from("wa_jobs")
    .update({ status: "geplant", run_at: jetzt.toISOString(), faellig_urspruenglich: jetzt.toISOString(), versuche: 0, ergebnis: "Einwilligung nachgetragen" })
    .eq("termin_id", termin.id)
    .eq("typ", "gebucht")
    .eq("status", "uebersprungen");
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
      { termin_id: terminId, typ, run_at: jetzt.toISOString(), faellig_urspruenglich: jetzt.toISOString(), status: "geplant" },
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
  const { error } = await svc
    .from("wa_termine")
    .update({ status: "abgesagt", abgesagt_am: jetzt.toISOString() })
    .eq("id", termin.id);
  if (error) throw new Error(`Absage nicht gespeichert: ${error.message}`);
  await brecheJobsAb(svc, [termin.id], opts.grund);
  if (opts.nachricht && termin.status === "geplant" && new Date(termin.start_at).getTime() > jetzt.getTime()) {
    await ereignisJob(svc, termin.id, "abgesagt", jetzt);
  }
}

/** Absage kam vor der Buchung (Webhook-Reihenfolge) → Platzhalter, damit „created“ nichts wiederbelebt. */
export async function legeAbsagePlatzhalterAn(
  svc: SupabaseClient,
  e: { art: TerminArt; calendly_event_uri: string; start_at: string },
  jetzt: Date = new Date(),
): Promise<void> {
  const { error } = await svc.from("wa_termine").insert({
    ...e,
    quelle: "calendly",
    status: "abgesagt",
    abgesagt_am: jetzt.toISOString(),
    token: zufallsToken(),
  });
  if (error && error.code !== "23505") throw new Error(`Absage-Platzhalter nicht angelegt: ${error.message}`);
}

/** No-Show: Status „verpasst“, offene Jobs abbrechen, „verpasst“-Nachricht sofort planen. */
export async function markiereVerpasst(
  svc: SupabaseClient,
  termin: Termin,
  ergebnisProtokollId: string,
  jetzt: Date = new Date(),
): Promise<void> {
  const { error } = await svc
    .from("wa_termine")
    .update({ status: "verpasst", ergebnis_protokoll_id: ergebnisProtokollId })
    .eq("id", termin.id);
  if (error) throw new Error(`No-Show nicht gespeichert: ${error.message}`);
  await brecheJobsAb(svc, [termin.id], "Termin verpasst");
  await ereignisJob(svc, termin.id, "verpasst", jetzt);
}

/** Gespräch hat stattgefunden (Protokoll in Close): offene Jobs abbrechen. */
export async function markiereStattgefunden(svc: SupabaseClient, termin: Termin, ergebnisProtokollId: string): Promise<void> {
  const { error } = await svc
    .from("wa_termine")
    .update({ status: "stattgefunden", ergebnis_protokoll_id: ergebnisProtokollId })
    .eq("id", termin.id);
  if (error) throw new Error(`Status nicht gespeichert: ${error.message}`);
  await brecheJobsAb(svc, [termin.id], "Gespräch hat stattgefunden");
}

export async function ladeTerminPerToken(svc: SupabaseClient, token: string): Promise<Termin | null> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(token)) return null;
  const { data } = await svc.from("wa_termine").select("*").eq("token", token).maybeSingle();
  return (data as Termin | null) ?? null;
}

/** Termin, dem ein Ergebnis-Protokoll schon zugeordnet ist (Wiederholung/Bearbeitung). */
export async function terminZumErgebnisProtokoll(svc: SupabaseClient, protokollId: string): Promise<Termin | null> {
  const { data, error } = await svc.from("wa_termine").select("*").eq("ergebnis_protokoll_id", protokollId).maybeSingle();
  if (error) throw new Error(`Terminsuche fehlgeschlagen: ${error.message}`);
  return (data as Termin | null) ?? null;
}

/** Zuletzt begonnener, noch offener Termin eines Close-Leads (für No-Show/Stattgefunden). */
export async function letzterTerminDesLeads(
  svc: SupabaseClient,
  leadId: string,
  art: TerminArt,
  jetzt: Date = new Date(),
): Promise<Termin | null> {
  const { data, error } = await svc
    .from("wa_termine")
    .select("*")
    .eq("close_lead_id", leadId)
    .eq("art", art)
    .eq("status", "geplant")
    .is("ergebnis_protokoll_id", null)
    .lte("start_at", new Date(jetzt.getTime() + 2 * 60 * 60_000).toISOString())
    .order("start_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Terminsuche fehlgeschlagen: ${error.message}`);
  return ((data as Termin[] | null) ?? [])[0] ?? null;
}
