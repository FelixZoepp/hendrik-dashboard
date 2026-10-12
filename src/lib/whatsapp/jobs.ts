import type { SupabaseClient } from "@supabase/supabase-js";
import { aufgabeAnLead } from "./close-log";
import { OhneWiederholung, sendeVorlage, VersandUnklar } from "./gate";
import {
  anredeName,
  berlinDatum,
  erinnerungsTag,
  formatDatum,
  formatUhrzeit,
  gleichNochPassend,
  MAX_VERSPAETUNG_MS,
  metaParameter,
  MIN_REST_MS,
  sendeFrist,
  type JobTyp,
} from "./logik";
import { AUFGABEN, ORT_FALLBACK_STRATEGIE, vorlageFuer, type VorlageDef } from "./vorlagen";
import type { Termin } from "./termine";

/**
 * Worker für wa_jobs: wird minütlich vom Cron aufgerufen, holt fällige Jobs per
 * wa_jobs_claim (FOR UPDATE SKIP LOCKED) und verarbeitet sie.
 * - Kein Nachholen: mehr als 15 Min. nach der ursprünglichen Fälligkeit → übersprungen
 *   (Wiederholungen nach Fehlern verschieben diese Deadline nicht).
 * - Zeitbudget wird vor jedem Job geprüft; nicht bearbeitete Jobs gehen zurück auf „geplant“.
 * - Unklares Versand-Ergebnis → „fehler“, kein automatischer Neuversand.
 */

interface Job {
  id: string;
  termin_id: string;
  typ: JobTyp;
  run_at: string;
  faellig_urspruenglich: string;
  status: string;
  versuche: number;
  claimed_at: string;
}

type JobAusgang =
  | { status: "erledigt" | "uebersprungen"; ergebnis: string }
  | { status: "geplant"; run_at: Date; ergebnis: string; neueDeadline?: boolean }
  | { status: "fehler"; fehler: string };

const MAX_VERSUCHE = 3;

/** Werte für {{1}}, {{2}} … einer Vorlage. */
export function vorlagenWerte(v: VorlageDef, t: Termin, jetzt: Date): string[] {
  const start = new Date(t.start_at);
  return v.werte.map((w) => {
    switch (w) {
      case "name":
        return metaParameter(anredeName(t.name, t.vorname, t.firma));
      case "datum":
        return metaParameter(formatDatum(start));
      case "uhrzeit":
        return metaParameter(formatUhrzeit(start));
      case "tag":
        return metaParameter(erinnerungsTag(start, jetzt));
      case "ort":
        return metaParameter(t.ort_text || ORT_FALLBACK_STRATEGIE);
    }
  });
}

async function verarbeiteJob(svc: SupabaseClient, job: Job, jetzt: Date): Promise<JobAusgang> {
  if (jetzt.getTime() - new Date(job.faellig_urspruenglich).getTime() > MAX_VERSPAETUNG_MS) {
    return { status: "uebersprungen", ergebnis: "Mehr als 15 Min. überfällig (kein Nachholen)" };
  }

  const { data, error } = await svc.from("wa_termine").select("*").eq("id", job.termin_id).maybeSingle();
  if (error) throw new Error(`Termin nicht lesbar: ${error.message}`);
  const termin = data as Termin | null;
  if (!termin) return { status: "uebersprungen", ergebnis: "Termin nicht gefunden" };

  const erwarteterStatus = job.typ === "verpasst" ? "verpasst" : job.typ === "abgesagt" ? "abgesagt" : "geplant";
  if (termin.status !== erwarteterStatus) {
    return { status: "uebersprungen", ergebnis: `Termin ist ${termin.status}` };
  }
  const start = new Date(termin.start_at);
  const frist = sendeFrist(job.typ, start, termin.abgesagt_am ? new Date(termin.abgesagt_am) : null);
  if (jetzt.getTime() >= frist.getTime()) {
    return { status: "uebersprungen", ergebnis: "Sendefrist abgelaufen" };
  }

  if ((job.typ === "erinnerung" || job.typ === "gleich" || job.typ === "unbestaetigt_check") && termin.verschieben_am) {
    return { status: "uebersprungen", ergebnis: "Lead möchte verschieben" };
  }
  if (job.typ === "unbestaetigt_check") return unbestaetigtCheck(svc, termin);
  if (job.typ === "erinnerung" && termin.bestaetigt_am) {
    return { status: "uebersprungen", ergebnis: "Termin bereits bestätigt" };
  }
  if (job.typ === "gleich" && !gleichNochPassend(start, termin.art, jetzt)) {
    return { status: "uebersprungen", ergebnis: "Zeitangabe „in … Minuten“ würde nicht mehr stimmen" };
  }

  const vorlage = vorlageFuer(termin.art, job.typ as VorlageDef["typ"]);
  if (!vorlage) return { status: "uebersprungen", ergebnis: `Keine Vorlage für ${termin.art}/${job.typ}` };

  const r = await sendeVorlage(svc, {
    termin,
    typ: job.typ,
    vorlage,
    werte: vorlagenWerte(vorlage, termin, jetzt),
    ruhezeit: { spaetestens: frist },
    jetzt,
  });
  if (r.gesendet) return { status: "erledigt", ergebnis: `Gesendet: ${vorlage.name} (${r.waMessageId})` };
  // Ruhezeit: bewusste Verschiebung auf 8:00 → neue Deadline ab dort
  if (r.verschiebenAuf) return { status: "geplant", run_at: r.verschiebenAuf, ergebnis: r.grund, neueDeadline: true };
  return { status: "uebersprungen", ergebnis: r.grund };
}

/** 2 Std. vorher nicht bestätigt → Close-Aufgabe (keine Nachricht an den Lead). */
async function unbestaetigtCheck(svc: SupabaseClient, termin: Termin): Promise<JobAusgang> {
  if (termin.bestaetigt_am) return { status: "uebersprungen", ergebnis: "Termin bereits bestätigt" };
  if (!termin.close_lead_id) return { status: "uebersprungen", ergebnis: "Kein Close-Lead zugeordnet" };
  // Nur nachhaken, wenn der Lead tatsächlich um Bestätigung gebeten wurde
  const { count, error } = await svc
    .from("wa_nachrichten")
    .select("id", { count: "exact", head: true })
    .eq("termin_id", termin.id)
    .eq("richtung", "aus")
    .eq("typ", "template")
    .in("status", ["gesendet", "zugestellt", "gelesen"]);
  if (error) throw new Error(`Nachrichten nicht lesbar: ${error.message}`);
  if (!count) return { status: "uebersprungen", ergebnis: "Keine Bestätigungsanfrage gesendet" };
  const id = await aufgabeAnLead(termin.close_lead_id, AUFGABEN.unbestaetigt, {
    datum: berlinDatum(new Date()),
    zustaendig: termin.close_user_id,
  });
  return { status: "erledigt", ergebnis: id ? `Close-Aufgabe ${id}` : "Close-Aufgabe existiert bereits" };
}

/** Job-Ergebnis schreiben — nur, solange der Job noch von diesem Lauf gehalten wird. */
async function schreibeAusgang(svc: SupabaseClient, job: Job, ausgang: JobAusgang): Promise<void> {
  const update: Record<string, unknown> =
    ausgang.status === "fehler"
      ? { status: "fehler", fehler: ausgang.fehler.slice(0, 1000) }
      : ausgang.status === "geplant"
        ? {
            status: "geplant",
            run_at: ausgang.run_at.toISOString(),
            ergebnis: ausgang.ergebnis.slice(0, 1000),
            claimed_at: null,
            ...(ausgang.neueDeadline ? { faellig_urspruenglich: ausgang.run_at.toISOString(), versuche: 0 } : {}),
          }
        : { status: ausgang.status, ergebnis: ausgang.ergebnis.slice(0, 1000) };
  const { error } = await svc
    .from("wa_jobs")
    .update(update)
    .eq("id", job.id)
    .eq("status", "laeuft")
    .eq("claimed_at", job.claimed_at);
  if (error) throw new Error(`Job ${job.id} nicht aktualisiert: ${error.message}`);
}

/** Fällige Jobs abarbeiten, bis keine mehr da sind oder das Zeitbudget aufgebraucht ist. */
export async function verarbeiteJobs(
  svc: SupabaseClient,
  opts: { deadline: number },
): Promise<{ verarbeitet: number; zurueckgelegt: number; ergebnisse: Record<string, number> }> {
  // Vor jedem Job müssen ≥ 15 s bleiben (Meta- und Close-Zeitlimits je 10 s)
  const ende = opts.deadline - MIN_REST_MS;
  const ergebnisse: Record<string, number> = {};
  let verarbeitet = 0;
  let zurueckgelegt = 0;

  while (Date.now() < ende) {
    const { data, error } = await svc.rpc("wa_jobs_claim", { p_limit: 5 });
    if (error) throw new Error(`Jobs nicht abrufbar: ${error.message}`);
    const jobs = (data ?? []) as Job[];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      if (Date.now() >= ende) {
        // Budget aufgebraucht → unbearbeitet zurücklegen (ohne Versuch zu zählen)
        await svc
          .from("wa_jobs")
          .update({ status: "geplant", claimed_at: null, versuche: Math.max(0, job.versuche - 1) })
          .eq("id", job.id)
          .eq("status", "laeuft")
          .eq("claimed_at", job.claimed_at);
        zurueckgelegt++;
        continue;
      }
      const jetzt = new Date();
      let ausgang: JobAusgang;
      try {
        ausgang = await verarbeiteJob(svc, job, jetzt);
      } catch (err) {
        const fehler = err instanceof Error ? err.message : String(err);
        ausgang =
          err instanceof VersandUnklar
            ? { status: "fehler", fehler: `${fehler} — bitte in WhatsApp prüfen, ob die Nachricht ankam` }
            : err instanceof OhneWiederholung
              ? { status: "fehler", fehler }
              : job.versuche < MAX_VERSUCHE
              ? // Kurz erneut versuchen — die feste Deadline (15 Min.) begrenzt Wiederholungen
                { status: "geplant", run_at: new Date(jetzt.getTime() + 2 * 60_000), ergebnis: `Fehler: ${fehler}` }
              : { status: "fehler", fehler };
      }
      await schreibeAusgang(svc, job, ausgang);
      ergebnisse[ausgang.status] = (ergebnisse[ausgang.status] ?? 0) + 1;
      verarbeitet++;
    }
  }
  return { verarbeitet, zurueckgelegt, ergebnisse };
}
