import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { waVerbindung } from "@/lib/whatsapp/client";
import { ladeEinstellungen, speichereEinstellung } from "@/lib/whatsapp/einstellungen";
import { verarbeiteOffeneEingaenge } from "@/lib/whatsapp/eingang";
import { verarbeiteJobs } from "@/lib/whatsapp/jobs";
import { gleicheVorlagenAb } from "@/lib/whatsapp/verwaltung";
import { sendeFaelligeBerichte } from "@/lib/sales-bericht";
import { berlinTeile } from "@/lib/whatsapp/logik";

// WhatsApp-Terminbot: minütlich per Supabase pg_cron + pg_net (supabase/cron_whatsapp.sql).
// Arbeitet liegengebliebene Eingänge und fällige Jobs ab (max. ~50 s) und gleicht stündlich
// den Vorlagen-Status bei Meta ab. Stößt außerdem tagsüber stündlich den Close- und Calendly-Sync an
// (Vercel-Cron im Hobby-Tarif nur 1× täglich).

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ABGLEICH_ALLE_MS = 60 * 60_000;
const CLOSE_SYNC_KEY = "close_sync_am";
/** Close-Sync stündlich zwischen 07:00 und 21:59 (Berlin) */
const CLOSE_SYNC_STUNDEN = { von: 7, bis: 21 };

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

  // Sales-Auswertung nach Slack: Mo–Fr 19:00 (freitags + Woche), einmal pro Tag
  try {
    if (deadline - Date.now() >= 20_000) antwort.bericht = await sendeFaelligeBerichte(supabase);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("webhook_errors").insert({ endpoint: "whatsapp", payload: { cron: "bericht" }, error: message });
    antwort.berichtFehler = message;
  }

  // Close- und Calendly-Sync stündlich anstoßen: laufen als eigene Requests (maxDuration 300 s), hier nur auslösen
  try {
    const stunde = berlinTeile(new Date()).stunde;
    if (stunde >= CLOSE_SYNC_STUNDEN.von && stunde <= CLOSE_SYNC_STUNDEN.bis) {
      const { data } = await supabase.from("wa_einstellungen").select("wert").eq("key", CLOSE_SYNC_KEY).maybeSingle();
      const zuletzt = typeof data?.wert === "string" ? new Date(data.wert).getTime() : 0;
      if (Date.now() - zuletzt > ABGLEICH_ALLE_MS) {
        // Vorab markieren, damit ein Fehler nicht jede Minute erneut auslöst
        const { error } = await supabase
          .from("wa_einstellungen")
          .upsert({ key: CLOSE_SYNC_KEY, wert: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "key" });
        if (error) throw new Error(`Close-Sync-Marker nicht gespeichert: ${error.message}`);
        // Close und Calendly (Absagen/Verschiebungen/neue Buchungen) als eigene Requests
        for (const pfad of ["/api/cron/sync-close", "/api/cron/sync-calendly"]) {
          const url = new URL(pfad, request.url);
          after(() =>
            fetch(url, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(55_000) }).catch(() => {}),
          );
        }
        antwort.closeSync = "angestoßen";
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("webhook_errors").insert({ endpoint: "whatsapp", payload: { cron: "close-sync" }, error: message });
    antwort.closeSyncFehler = message;
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
