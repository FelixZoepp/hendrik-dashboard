import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { waVerbindung } from "@/lib/whatsapp/client";
import { ladeEinstellungen, speichereEinstellung } from "@/lib/whatsapp/einstellungen";
import { verarbeiteOffeneEingaenge } from "@/lib/whatsapp/eingang";
import { verarbeiteJobs } from "@/lib/whatsapp/jobs";
import { gleicheVorlagenAb } from "@/lib/whatsapp/verwaltung";

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

  try {
    antwort.eingang = await verarbeiteOffeneEingaenge(supabase, { budgetMs: 10_000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("webhook_errors").insert({ endpoint: "whatsapp", payload: { cron: "eingang" }, error: message });
    antwort.eingangFehler = message;
  }

  try {
    antwort.jobs = await verarbeiteJobs(supabase, { budgetMs: 35_000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("webhook_errors").insert({ endpoint: "whatsapp", payload: { cron: "jobs" }, error: message });
    antwort.jobsFehler = message;
  }

  // Vorlagen-Status stündlich abgleichen (nur lesen)
  try {
    if (waVerbindung().verbunden) {
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
