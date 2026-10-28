"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { rueckrufZeit, zeitpunktText } from "@/lib/crm/logik";
import { TERMIN_ART_WERTE, statusRang, type TerminArt, type TerminStatus } from "@/lib/auswertung/logik";
import { tabelleFehlt, terminEinfuegen } from "@/lib/auswertung/erfassung";
import type { LeadStatus } from "@/lib/types/database";

// Regel (siehe src/lib/kontext.ts): Service-Client + IMMER company_id aus requireKunde(),
// requireKunde() steht vor try/catch.

type Ergebnis<T> = { data: T | null; error: string | null };

const uuid = z.string().uuid("Ungültige ID");

function fehlerText(err: unknown) {
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? "Eingabe stimmt nicht";
  return err instanceof Error ? err.message : "Unbekannter Fehler";
}

function neuLaden(leadId: string) {
  revalidatePath("/leads", "page");
  revalidatePath("/dashboard", "page");
  revalidatePath("/auswertung", "page");
  revalidatePath(`/leads/${leadId}`, "page");
}

async function notiz(db: ReturnType<typeof createAdminClient>, leadId: string, userId: string, inhalt: string) {
  await db.from("lead_activities").insert({ lead_id: leadId, user_id: userId, typ: "notiz", inhalt, alt_status: null, neu_status: null });
}

const ART_TEXT: Record<TerminArt, string> = { vor_ort: "Termin vor Ort", telefon: "Telefontermin", video: "Videotermin" };

const anlegenSchema = z.object({
  leadId: uuid,
  beginn: z.string().datetime({ offset: true, message: "Bitte Datum und Uhrzeit wählen" }),
  art: z.enum(TERMIN_ART_WERTE).default("vor_ort"),
  ersetztId: uuid.nullable().optional(),
  notiz: z.string().max(500).nullable().optional(),
});

/**
 * Neuer Termin (auch Neuvereinbarung nach No-Show / Verschieben).
 * Ohne ersetztId wird automatisch der letzte offene No-Show/verschobene Termin verknüpft.
 * Lead in „Neu“/„Kontaktiert“ rückt auf „Termin vor Ort“.
 */
export async function terminAnlegen(
  leadId: string,
  eingabe: { beginn: string; art?: TerminArt; ersetztId?: string | null; notiz?: string | null }
): Promise<Ergebnis<{ id: string }>> {
  const { companyId, profile } = await requireKunde();
  try {
    const v = anlegenSchema.parse({ leadId, ...eingabe });
    const db = createAdminClient();
    const { data: lead } = await db
      .from("leads")
      .select("id, status")
      .eq("id", v.leadId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!lead) return { data: null, error: "Lead nicht gefunden" };

    const t = await terminEinfuegen(db, {
      leadId: v.leadId,
      companyId,
      userId: profile.id,
      beginn: v.beginn,
      art: v.art,
      ersetztId: v.ersetztId ?? null,
      notiz: v.notiz ?? null,
    });
    if (t.error || !t.id) return { data: null, error: t.error ?? "Termin konnte nicht gespeichert werden" };

    const status = (lead as { status: LeadStatus }).status;
    const rang = statusRang(status);
    if (rang >= 0 && rang < 2) {
      await db
        .from("leads")
        .update({ status: "vor_ort_termin", geaendert_von: profile.id })
        .eq("id", v.leadId)
        .eq("company_id", companyId);
    }
    await notiz(db, v.leadId, profile.id, `${v.ersetztId ? "Neuer Termin" : ART_TEXT[v.art]}: ${zeitpunktText(v.beginn)}`);
    neuLaden(v.leadId);
    return { data: { id: t.id }, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

const ERGEBNIS_WERTE = ["stattgefunden", "nicht_erschienen", "abgesagt", "verschoben"] as const;

const ERGEBNIS_NOTIZ: Record<(typeof ERGEBNIS_WERTE)[number], string> = {
  stattgefunden: "Termin hat stattgefunden",
  nicht_erschienen: "Termin: Kunde nicht erschienen",
  abgesagt: "Termin abgesagt",
  verschoben: "Termin verschoben",
};

/**
 * „Wie war der Termin?“ — 1 Tipp. Nicht erschienen → Rückruf vorschlagen (heute später bzw. morgen 9 Uhr),
 * damit der Lead unter „Heute anrufen“/„No-Show zurückholen“ auftaucht.
 */
export async function terminErgebnis(
  terminId: string,
  status: Exclude<TerminStatus, "geplant">
): Promise<Ergebnis<{ leadId: string; rueckruf: string | null }>> {
  const { companyId, profile } = await requireKunde();
  try {
    const id = uuid.parse(terminId);
    const neu = z.enum(ERGEBNIS_WERTE).parse(status);
    const db = createAdminClient();
    const { data: termin, error: lesen } = await db
      .from("lead_termine")
      .select("id, lead_id, status")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (lesen) return { data: null, error: tabelleFehlt(lesen) ? "Termine sind noch nicht freigeschaltet (Migration 00018)." : lesen.message };
    if (!termin) return { data: null, error: "Termin nicht gefunden" };
    const leadId = (termin as { lead_id: string }).lead_id;

    const { error } = await db
      .from("lead_termine")
      .update({ status: neu, ergebnis_am: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) return { data: null, error: error.message };

    let rueckruf: string | null = null;
    if (neu === "nicht_erschienen") {
      const { data: lead } = await db
        .from("leads")
        .select("status, naechste_aktion_am")
        .eq("id", leadId)
        .eq("company_id", companyId)
        .maybeSingle();
      const l = lead as { status: LeadStatus; naechste_aktion_am: string | null } | null;
      if (l && statusRang(l.status) >= 0 && l.status !== "gewonnen") {
        const vorschlag = (rueckrufZeit("heute_spaeter") ?? rueckrufZeit("morgen_9"))!.toISOString();
        // Vorhandenen früheren Rückruf nicht nach hinten schieben
        rueckruf = l.naechste_aktion_am && l.naechste_aktion_am < vorschlag ? l.naechste_aktion_am : vorschlag;
        await db.from("leads").update({ naechste_aktion_am: rueckruf }).eq("id", leadId).eq("company_id", companyId);
      }
    }
    await notiz(db, leadId, profile.id, ERGEBNIS_NOTIZ[neu] + (rueckruf ? ` – Rückruf ${zeitpunktText(rueckruf)} vorgemerkt` : ""));
    neuLaden(leadId);
    return { data: { leadId, rueckruf }, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}
