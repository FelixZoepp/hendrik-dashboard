"use server";

import { revalidatePath } from "next/cache";
import { requireKunde } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { firmaAktivieren } from "@/lib/firma-aktivieren";

/**
 * Formulare After-Close und Zugänge: speichern über den Server (Service-Client), Firma IMMER aus requireKunde().
 *
 * Vorher schrieb der Browser-Client direkt in form_submissions — ohne company_id. Dadurch lehnte RLS
 * das Speichern für Kunden ab (Policy verlangt company_id = eigene Firma), und beim „Als Kunde ansehen“
 * landete der Eintrag ohne Firma. Jetzt: company_id = ctx.companyId, submitted_by = angemeldete Person.
 * Absenden beim „Als Kunde ansehen“ ist eine bewusste Handlung des Teams (füllt für den Kunden aus).
 */

export type FormularTyp = "after_close" | "zugaenge";

const MAX_FELDER = 60;
const MAX_LAENGE = 5000;

function bereinigen(eingabe: unknown): Record<string, string> {
  const aus: Record<string, string> = {};
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return aus;
  for (const [k, v] of Object.entries(eingabe as Record<string, unknown>).slice(0, MAX_FELDER)) {
    if (!/^[a-z0-9_]{1,64}$/i.test(k) || typeof v !== "string") continue;
    const wert = v.trim().slice(0, MAX_LAENGE);
    if (wert) aus[k] = wert;
  }
  return aus;
}

export async function formularAbsenden(typ: FormularTyp, daten: Record<string, string>): Promise<{ error: string | null }> {
  const ctx = await requireKunde();
  if (typ !== "after_close" && typ !== "zugaenge") return { error: "Unbekanntes Formular" };
  const payload = bereinigen(daten);

  try {
    const db = createAdminClient();
    const { error } = await db.from("form_submissions").insert({
      typ,
      company_id: ctx.companyId,
      submitted_by: ctx.profile.id,
      payload,
    });
    if (error) return { error: error.message };

    // Auto-Aktivierung nach dem After-Close-Formular (wie bisher): Firma aktiv + Projekte aus Templates.
    // Nur solange die Firma noch im Onboarding ist – sonst würden Projekte doppelt angelegt.
    if (typ === "after_close" && ctx.company.status === "onboarding") {
      const res = await firmaAktivieren(db, ctx.companyId);
      if (!res.ok) console.error(`Auto-Aktivierung fehlgeschlagen: ${res.fehler}`);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unbekannter Fehler" };
  }

  revalidatePath("/dashboard", "page");
  revalidatePath("/status", "page");
  revalidatePath(`/kunden/${ctx.companyId}`, "page");
  return { error: null };
}
