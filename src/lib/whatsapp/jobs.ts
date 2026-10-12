import type { SupabaseClient } from "@supabase/supabase-js";
import { aufgabeAnLead } from "./close-log";
import { sendeVorlage } from "./gate";
import {
  anredeName,
  berlinDatum,
  erinnerungsTag,
  formatDatum,
  formatUhrzeit,
  MAX_VERSPAETUNG_MS,
  metaParameter,
  type JobTyp,
} from "./logik";
import { AUFGABEN, ORT_FALLBACK_STRATEGIE, vorlageFuer, type VorlageDef } from "./vorlagen";
import type { Termin } from "./termine";

/**
 * Worker für wa_jobs: wird minütlich vom Cron aufgerufen, holt fällige Jobs per
 * wa_jobs_claim (FOR UPDATE SKIP LOCKED) und verarbeitet sie.
 * Kein Nachholen: Jobs, die mehr als 15 Min. überfällig sind, werden übersprungen.
 */

interface Job {
  id: string;
  termin_id: string;
  typ: JobTyp;
  run_at: string;
  status: string;
  versuche: number;
}

type JobAusgang =
  | { status: "erledigt" | "uebersprungen"; ergebnis: string }
  | { status: "geplant"; run_at: Date; ergebnis: string; versuche?: number }
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
  if (jetzt.getTime() - new Date(job.run_at).getTime() > MAX_VERSPAETUNG_MS) {
    return { status: "uebersprungen", ergebnis: "Mehr als 15 Min. überfällig (kein Nachholen)" };
  }

  const { data } = await svc.from("wa_termine").select("*").eq("id", job.termin_id).maybeSingle();
  const termin = data as Termin | null;
  if (!termin) return { status: "uebersprungen", ergebnis: "Termin nicht gefunden" };

  const erwarteterStatus = job.typ === "verpasst" ? "verpasst" : job.typ === "abgesagt" ? "abgesagt" : "geplant";
  if (termin.status !== erwarteterStatus) {
    return { status: "uebersprungen", ergebnis: `Termin ist ${termin.status}` };
  }
  const start = new Date(termin.start_at);
  if (erwarteterStatus === "geplant" && start.getTime() <= jetzt.getTime()) {
    return { status: "uebersprungen", ergebnis: "Termin hat schon begonnen" };
  }

  if (job.typ === "unbestaetigt_check") return unbestaetigtCheck(svc, termin);

  if (job.typ === "erinnerung" && termin.bestaetigt_am) {
    return { status: "uebersprungen", ergebnis: "Termin bereits bestätigt" };
  }

  const vorlage = vorlageFuer(termin.art, job.typ as VorlageDef["typ"]);
  if (!vorlage) return { status: "uebersprungen", ergebnis: `Keine Vorlage für ${termin.art}/${job.typ}` };

  const r = await sendeVorlage(svc, {
    termin,
    vorlage,
    werte: vorlagenWerte(vorlage, termin, jetzt),
    // Termin-Nachrichten dürfen nicht nach Beginn kommen; verpasst/abgesagt immer am Morgen
    ruhezeit: { spaetestens: erwarteterStatus === "geplant" ? start : null },
    jetzt,
  });
  if (r.gesendet) return { status: "erledigt", ergebnis: `Gesendet: ${vorlage.name} (${r.waMessageId})` };
  if (r.verschiebenAuf) return { status: "geplant", run_at: r.verschiebenAuf, ergebnis: r.grund, versuche: 0 };
  return { status: "uebersprungen", ergebnis: r.grund };
}

/** 2 Std. vorher nicht bestätigt → Close-Aufgabe (keine Nachricht an den Lead). */
async function unbestaetigtCheck(svc: SupabaseClient, termin: Termin): Promise<JobAusgang> {
  if (termin.bestaetigt_am) return { status: "uebersprungen", ergebnis: "Termin bereits bestätigt" };
  if (!termin.close_lead_id) return { status: "uebersprungen", ergebnis: "Kein Close-Lead zugeordnet" };
  // Nur nachhaken, wenn der Lead tatsächlich um Bestätigung gebeten wurde
  const { count } = await svc
    .from("wa_nachrichten")
    .select("id", { count: "exact", head: true })
    .eq("termin_id", termin.id)
    .eq("richtung", "aus")
    .eq("typ", "template")
    .neq("status", "fehlgeschlagen");
  if (!count) return { status: "uebersprungen", ergebnis: "Keine Bestätigungsanfrage gesendet" };
  const id = await aufgabeAnLead(termin.close_lead_id, AUFGABEN.unbestaetigt, {
    datum: berlinDatum(new Date()),
    zustaendig: termin.close_user_id,
  });
  return { status: "erledigt", ergebnis: id ? `Close-Aufgabe ${id}` : "Close-Aufgabe existiert bereits" };
}

/** Fällige Jobs abarbeiten, bis keine mehr da sind oder das Zeitbudget aufgebraucht ist. */
export async function verarbeiteJobs(
  svc: SupabaseClient,
  opts: { budgetMs?: number } = {},
): Promise<{ verarbeitet: number; ergebnisse: Record<string, number> }> {
  const ende = Date.now() + (opts.budgetMs ?? 50_000);
  const ergebnisse: Record<string, number> = {};
  let verarbeitet = 0;

  while (Date.now() < ende - 5_000) {
    const { data, error } = await svc.rpc("wa_jobs_claim", { p_limit: 10 });
    if (error) throw new Error(`Jobs nicht abrufbar: ${error.message}`);
    const jobs = (data ?? []) as Job[];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      const jetzt = new Date();
      let ausgang: JobAusgang;
      try {
        ausgang = await verarbeiteJob(svc, job, jetzt);
      } catch (err) {
        const fehler = err instanceof Error ? err.message : String(err);
        // Kurz erneut versuchen — das 15-Min.-Fenster begrenzt Wiederholungen ohnehin
        ausgang =
          job.versuche < MAX_VERSUCHE
            ? { status: "geplant", run_at: new Date(jetzt.getTime() + 2 * 60_000), ergebnis: `Fehler: ${fehler}`.slice(0, 500) }
            : { status: "fehler", fehler };
      }

      const update: Record<string, unknown> =
        ausgang.status === "fehler"
          ? { status: "fehler", fehler: ausgang.fehler.slice(0, 1000) }
          : ausgang.status === "geplant"
            ? {
                status: "geplant",
                run_at: ausgang.run_at.toISOString(),
                ergebnis: ausgang.ergebnis,
                claimed_at: null,
                ...(ausgang.versuche !== undefined ? { versuche: ausgang.versuche } : {}),
              }
            : { status: ausgang.status, ergebnis: ausgang.ergebnis.slice(0, 1000) };
      await svc.from("wa_jobs").update(update).eq("id", job.id);
      ergebnisse[ausgang.status] = (ergebnisse[ausgang.status] ?? 0) + 1;
      verarbeitet++;
    }
  }
  return { verarbeitet, ergebnisse };
}
