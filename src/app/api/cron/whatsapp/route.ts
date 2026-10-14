import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { waVerbindung } from "@/lib/whatsapp/client";
import { ladeEinstellungen, speichereEinstellung } from "@/lib/whatsapp/einstellungen";
import { verarbeiteOffeneEingaenge } from "@/lib/whatsapp/eingang";
import { verarbeiteJobs } from "@/lib/whatsapp/jobs";
import { gleicheVorlagenAb } from "@/lib/whatsapp/verwaltung";
import { sendeFaelligeBerichte } from "@/lib/sales-bericht";

// WhatsApp-Terminbot: minütlich per Supabase pg_cron + pg_net (supabase/cron_whatsapp.sql).
// Arbeitet liegengebliebene Eingänge und fällige Jobs ab (max. ~50 s) und gleicht stündlich
// den Vorlagen-Status bei Meta ab.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ABGLEICH_ALLE_MS = 60 * 60_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const antwort: Record<string, unknown> = {};
  // Eine gemeinsame absolute Deadline für alle Phasen (maxDuration 60 s)
  const deadline = Date.now() + 45_000;

  try {
    antwort.eingang = await verarbeiteOffeneEingaenge(supabase, { deadline });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("webhook_errors").insert({ endpoint: "whatsapp", payload: { cron: "eingang" }, error: message });
    antwort.eingangFehler = message;
  }

  try {
    antwort.jobs = await verarbeiteJobs(supabase, { deadline });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("webhook_errors").insert({ endpoint: "whatsapp", payload: { cron: "jobs" }, error: message });
    antwort.jobsFehler = message;
  }

  // Sales-Auswertung nach Slack: Mo–Fr 18:00 (freitags + Woche), einmal pro Tag
  try {
    if (deadline - Date.now() >= 20_000) antwort.bericht = await sendeFaelligeBerichte(supabase);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("webhook_errors").insert({ endpoint: "whatsapp", payload: { cron: "bericht" }, error: message });
    antwort.berichtFehler = message;
  }

  // Vorlagen-Status stündlich abgleichen (nur lesen)
  try {
    if (waVerbindung().verbunden && deadline - Date.now() >= 15_000) {
      const e = await ladeEinstellungen(supabase);
      const zuletzt = e.vorlagen_abgleich_am ? new Date(e.vorlagen_abgleich_am).getTime() : 0;
      if (Date.now() - zuletzt > ABGLEICH_ALLE_MS) {
        // Zeitstempel vorab setzen, damit ein Meta-Fehler nicht jede Minute erneut auftritt
        await speichereEinstellung(supabase, "vorlagen_abgleich_am", new Date().toISOString());
        antwort.vorlagen = await gleicheVorlagenAb(supabase);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("webhook_errors").insert({ endpoint: "whatsapp", payload: { cron: "vorlagen" }, error: message });
    antwort.vorlagenFehler = message;
  }

  return NextResponse.json({ ok: !antwort.jobsFehler, ...antwort });
}
