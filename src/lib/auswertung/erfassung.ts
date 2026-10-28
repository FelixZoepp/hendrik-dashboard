import type { createAdminClient } from "@/lib/supabase/admin";
import {
  offenerVersuch,
  zuErsetzenderTermin,
  type AnrufErgebnis,
  type ATermin,
  type Kanal,
  type TerminArt,
} from "@/lib/auswertung/logik";

/**
 * Schreiben der Auswertungs-Daten (lead_anrufe, lead_termine) — nur aus Server Actions aufrufen,
 * NACH requireKunde() und der Prüfung, dass der Lead zur Firma gehört.
 *
 * Kontaktversuche sind „best effort“: Fehlt die Tabelle (Migration 00018 noch nicht eingespielt)
 * oder klappt das Schreiben nicht, läuft der bisherige CRM-Ablauf trotzdem weiter.
 */

type Db = ReturnType<typeof createAdminClient>;

export function tabelleFehlt(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  return /does not exist|could not find the table/i.test(err.message ?? "");
}

function warnen(was: string, err: { message?: string } | null) {
  if (err) console.warn(`[auswertung] ${was}: ${err.message ?? err}`);
}

/** Tipp auf „Anrufen“/„WhatsApp“: neuer Versuch ohne Ergebnis. */
export async function versuchStarten(
  db: Db,
  e: { leadId: string; companyId: string; userId: string; kanal: Kanal },
): Promise<void> {
  const { error } = await db.from("lead_anrufe").insert({
    lead_id: e.leadId,
    company_id: e.companyId,
    user_id: e.userId,
    kanal: e.kanal,
    ergebnis: null,
  });
  warnen("Versuch speichern", error);
}

/** Ergebnis eintragen: offenen Anrufversuch (≤ 3 Std.) ergänzen, sonst neuen Versuch anlegen. */
export async function ergebnisEintragen(
  db: Db,
  e: { leadId: string; companyId: string; userId: string; ergebnis: AnrufErgebnis },
): Promise<void> {
  const jetzt = new Date();
  const seit = new Date(jetzt.getTime() - 3 * 60 * 60_000).toISOString();
  const { data, error } = await db
    .from("lead_anrufe")
    .select("id, am, kanal, ergebnis")
    .eq("lead_id", e.leadId)
    .eq("company_id", e.companyId)
    .eq("kanal", "anruf")
    .is("ergebnis", null)
    .gte("am", seit);
  if (error) {
    warnen("Versuche lesen", error);
    return;
  }
  const offen = offenerVersuch((data ?? []) as Array<{ id: string; am: string; kanal: Kanal; ergebnis: AnrufErgebnis | null }>, jetzt);
  if (offen) {
    const { error: upd } = await db
      .from("lead_anrufe")
      .update({ ergebnis: e.ergebnis })
      .eq("id", offen.id)
      .eq("company_id", e.companyId);
    warnen("Ergebnis speichern", upd);
    return;
  }
  const { error: ins } = await db.from("lead_anrufe").insert({
    lead_id: e.leadId,
    company_id: e.companyId,
    user_id: e.userId,
    kanal: "anruf",
    ergebnis: e.ergebnis,
    am: jetzt.toISOString(),
  });
  warnen("Versuch mit Ergebnis speichern", ins);
}

export interface TerminEingabe {
  leadId: string;
  companyId: string;
  userId: string;
  beginn: string;
  art: TerminArt;
  /** ausdrücklich ersetzter Termin (Verschieben/No-Show); sonst automatisch der offene No-Show */
  ersetztId?: string | null;
  notiz?: string | null;
}

/** Neuen Termin anlegen und mit dem alten (No-Show/verschoben) verknüpfen. */
export async function terminEinfuegen(db: Db, e: TerminEingabe): Promise<{ id: string | null; error: string | null }> {
  const { data: vorhandene, error: lesen } = await db
    .from("lead_termine")
    .select("id, lead_id, art, beginn, status, ersetzt_termin_id, created_at")
    .eq("lead_id", e.leadId)
    .eq("company_id", e.companyId);
  if (lesen) {
    return { id: null, error: tabelleFehlt(lesen) ? "Termine sind noch nicht freigeschaltet (Migration 00018)." : lesen.message };
  }
  const termine = (vorhandene ?? []) as ATermin[];

  let ersetzt: ATermin | null = null;
  if (e.ersetztId) {
    ersetzt = termine.find((t) => t.id === e.ersetztId) ?? null;
    if (!ersetzt) return { id: null, error: "Alter Termin nicht gefunden" };
  } else {
    ersetzt = zuErsetzenderTermin(termine);
  }

  const jetzt = new Date().toISOString();
  if (ersetzt && ersetzt.status === "geplant") {
    const { error } = await db
      .from("lead_termine")
      .update({ status: "verschoben", ergebnis_am: jetzt })
      .eq("id", ersetzt.id)
      .eq("company_id", e.companyId);
    if (error) return { id: null, error: error.message };
  }

  const { data, error } = await db
    .from("lead_termine")
    .insert({
      lead_id: e.leadId,
      company_id: e.companyId,
      art: e.art,
      beginn: e.beginn,
      status: "geplant",
      ersetzt_termin_id: ersetzt?.id ?? null,
      notiz: e.notiz?.trim() || null,
      created_by: e.userId,
    })
    .select("id")
    .single();
  if (error) return { id: null, error: error.message };
  return { id: (data as { id: string }).id, error: null };
}
