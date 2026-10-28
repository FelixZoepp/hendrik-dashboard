import type { createAdminClient } from "@/lib/supabase/admin";
import { ladeKalenderAbo } from "@/lib/kalender/daten";
import { kalenderStandAus, onboardingStand, type OnboardingDaten, type OnboardingStand } from "./logik";

/**
 * Onboarding-Stand einer Firma aus vorhandenen Daten (Kundenportal /dashboard und Team /kunden/[id]).
 * Service-Client, jede Abfrage auf company_id gefiltert. Fehler einzelner Abfragen zählen als „offen“,
 * eine fehlende Tabelle kalender_abos (Migration 00019) als „Wird eingerichtet“ — nie ein 500er.
 */

type Db = ReturnType<typeof createAdminClient>;

async function formularDa(db: Db, companyId: string, typ: "after_close" | "zugaenge"): Promise<boolean> {
  const { data, error } = await db.from("form_submissions").select("id").eq("company_id", companyId).eq("typ", typ).limit(1);
  return !error && (data ?? []).length > 0;
}

export async function ladeOnboardingDaten(db: Db, companyId: string): Promise<OnboardingDaten> {
  const [afterClose, zugaenge, kalender, anfragenRes, bearbeitetRes, offenRes, personenRes] = await Promise.all([
    formularDa(db, companyId, "after_close"),
    formularDa(db, companyId, "zugaenge"),
    ladeKalenderAbo(db, companyId),
    db.from("leads").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("ist_test", false),
    db
      .from("leads")
      .select("id")
      .eq("company_id", companyId)
      .eq("ist_test", false)
      .or("first_contact_at.not.is.null,status.neq.neu")
      .limit(1),
    db
      .from("leads")
      .select("id")
      .eq("company_id", companyId)
      .eq("ist_test", false)
      .eq("status", "neu")
      .is("first_contact_at", null)
      .order("created_at", { ascending: true })
      .limit(1),
    db.from("profiles").select("id").eq("company_id", companyId),
  ]);

  // Masterclass: Fortschritt irgendeiner Person der Firma (lesson_progress.user_id → profiles.company_id)
  const personen = ((personenRes.data ?? []) as { id: string }[]).map((p) => p.id);
  let lektion = false;
  if (personen.length > 0) {
    const { data, error } = await db.from("lesson_progress").select("id").in("user_id", personen.slice(0, 200)).limit(1);
    lektion = !error && (data ?? []).length > 0;
  }

  return {
    afterClose,
    zugaenge,
    kalender: kalender.fehlt ? null : kalenderStandAus(kalender.abo),
    anfragen: anfragenRes.error ? 0 : anfragenRes.count ?? 0,
    bearbeitet: !bearbeitetRes.error && (bearbeitetRes.data ?? []).length > 0,
    offeneAnfrageId: ((offenRes.data ?? []) as { id: string }[])[0]?.id ?? null,
    lektion,
  };
}

export async function ladeOnboarding(db: Db, companyId: string): Promise<OnboardingStand> {
  return onboardingStand(await ladeOnboardingDaten(db, companyId));
}
