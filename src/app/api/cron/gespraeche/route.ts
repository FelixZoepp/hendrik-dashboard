import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { analysiereOffene } from "@/lib/gespraeche/analyse";
import { ladeNeueHoch, pruefeHochgeladene } from "@/lib/gespraeche/ablauf";
import { synchronisiereAnrufe } from "@/lib/gespraeche/close-anrufe";
import { firefliesAktiv } from "@/lib/gespraeche/fireflies";

// Gesprächsanalyse: alle 5 Minuten per Supabase pg_cron + pg_net (supabase/cron_gespraeche.sql).
// Close-Calls übernehmen → offene Fireflies-Transkripte abholen → wichtige Calls hochladen
// (Tagesbudget) → Transkripte per KI analysieren, solange Zeit ist.

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const antwort: Record<string, unknown> = {};
  // Eine gemeinsame absolute Deadline für alle Phasen (maxDuration 300 s)
  const deadline = Date.now() + 280_000;

  const schritt = async (name: string, fn: () => Promise<unknown>) => {
    try {
      antwort[name] = await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase.from("webhook_errors").insert({ endpoint: "gespraeche", payload: { cron: name }, error: message });
      antwort[`${name}Fehler`] = message;
    }
  };

  await schritt("sync", () => synchronisiereAnrufe(supabase));
  if (firefliesAktiv()) {
    // Erst abholen, dann hochladen — sonst verbrauchen Uploads das Budget für die Transkripte
    await schritt("transkripte", () => pruefeHochgeladene(supabase, deadline));
    await schritt("upload", () => ladeNeueHoch(supabase, deadline));
  } else {
    antwort.fireflies = "FIREFLIES_API_KEY fehlt";
  }
  await schritt("analyse", () => analysiereOffene(supabase, deadline));

  return NextResponse.json({ ok: !Object.keys(antwort).some((k) => k.endsWith("Fehler")), ...antwort });
}
