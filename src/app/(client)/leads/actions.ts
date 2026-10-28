"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { z } from "zod";
import {
  STUFEN_IDS,
  VERLUST_GRUENDE,
  heuteEnde,
  pruefeStufenWechsel,
  statusFuerStufe,
  stufeVon,
  stufenInfo,
  teileName,
  zeitpunktText,
  type Stufe,
} from "@/lib/crm/logik";
import {
  ANRUF_ERGEBNIS_WERTE,
  TERMIN_ART_WERTE,
  istErreicht,
  type AnrufErgebnis,
  type TerminArt,
} from "@/lib/auswertung/logik";
import { ergebnisEintragen, terminEinfuegen, versuchStarten } from "@/lib/auswertung/erfassung";
import type {
  Lead,
  LeadActivity,
  LeadStatus,
  LeadActivityTyp,
  VerlustGrund,
  LeadQuelle,
} from "@/lib/types/database";

// Regel (siehe src/lib/kontext.ts): Service-Client + IMMER company_id aus requireKunde().
// requireKunde() steht vor try/catch, damit dessen redirect() nicht verschluckt wird.
//
// Status-Verlauf: Den Eintrag „status_wechsel“ schreibt NUR der DB-Trigger
// log_lead_status_change (Migration 00015). Actions setzen beim Statuswechsel
// geaendert_von = profile.id, damit der Trigger weiß, wer es war (Service-Client → auth.uid() = null).

type Db = ReturnType<typeof createAdminClient>;
type Ergebnis<T> = { data: T | null; error: string | null };

async function gehoertZurFirma(db: Db, leadId: string, companyId: string) {
  const { data } = await db.from("leads").select("id").eq("id", leadId).eq("company_id", companyId).maybeSingle();
  return !!data;
}

function fehlerText(err: unknown) {
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? "Eingabe stimmt nicht";
  return err instanceof Error ? err.message : "Unbekannter Fehler";
}

function neuLaden(leadId?: string) {
  revalidatePath("/leads", "page");
  revalidatePath("/dashboard", "page");
  revalidatePath("/auswertung", "page");
  if (leadId) revalidatePath(`/leads/${leadId}`, "page");
}

async function aktivitaet(db: Db, leadId: string, userId: string, typ: LeadActivityTyp, inhalt: string) {
  await db.from("lead_activities").insert({
    lead_id: leadId,
    user_id: userId,
    typ,
    inhalt,
    alt_status: null,
    neu_status: null,
  });
}

const LEAD_STATUS = [
  "neu",
  "kontaktiert",
  "termin_vereinbart",
  "vor_ort_termin",
  "angebot_raus",
  "gewonnen",
  "verloren",
  "kein_interesse",
  "nicht_erreicht",
] as const;

const VERLUST_WERTE = VERLUST_GRUENDE.map((g) => g.value) as [VerlustGrund, ...VerlustGrund[]];
const uuid = z.string().uuid("Ungültige ID");

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

const getLeadsFiltersSchema = z
  .object({
    status: z.enum(LEAD_STATUS).optional(),
    search: z.string().optional(),
  })
  .optional();

export async function getLeads(
  filters?: { status?: LeadStatus; search?: string }
): Promise<{ data: (Lead & { company_name: string })[] | null; error: string | null }> {
  const { companyId } = await requireKunde();
  try {
    const parsed = getLeadsFiltersSchema.parse(filters);
    const supabase = createAdminClient();

    let query = supabase
      .from("leads")
      .select("*, companies!inner(name)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (parsed?.status) query = query.eq("status", parsed.status);
    if (parsed?.search) {
      const term = `%${parsed.search.replace(/[,()]/g, " ")}%`;
      query = query.or(
        `vorname.ilike.${term},nachname.ilike.${term},email.ilike.${term},telefon.ilike.${term},ort.ilike.${term}`
      );
    }

    const { data, error } = await query;
    if (error) return { data: null, error: error.message };

    type LeadWithCompany = Lead & { companies: { name: string } };
    const leads = ((data ?? []) as unknown as LeadWithCompany[]).map((row) => {
      const { companies, ...lead } = row;
      return { ...lead, company_name: companies.name };
    });
    return { data: leads, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

export async function getLead(
  id: string
): Promise<Ergebnis<Lead & { company_name: string; activities: LeadActivity[] }>> {
  const { companyId } = await requireKunde();
  try {
    const validId = uuid.parse(id);
    const supabase = createAdminClient();

    const { data: leadRow, error: leadError } = await supabase
      .from("leads")
      .select("*, companies!inner(name)")
      .eq("id", validId)
      .eq("company_id", companyId)
      .single();
    if (leadError) return { data: null, error: leadError.message };

    const { data: activities, error: activitiesError } = await supabase
      .from("lead_activities")
      .select("*")
      .eq("lead_id", validId)
      .order("created_at", { ascending: false });
    if (activitiesError) return { data: null, error: activitiesError.message };

    const { companies, ...lead } = leadRow as unknown as Lead & { companies: { name: string } };
    return {
      data: { ...lead, company_name: companies.name, activities: (activities ?? []) as LeadActivity[] },
      error: null,
    };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

// ---------------------------------------------------------------------------
// Stufe ändern (Kanban, Knopfleiste)
// ---------------------------------------------------------------------------

const stufeSchema = z.object({
  id: uuid,
  stufe: z.enum(STUFEN_IDS as [Stufe, ...Stufe[]]),
  angebotswert: z.number().nonnegative().nullable().optional(),
  auftragswert: z.number().positive("Auftragswert muss größer als 0 sein").nullable().optional(),
  verlust_grund: z.enum(VERLUST_WERTE).nullable().optional(),
  verlust_notiz: z.string().max(500).nullable().optional(),
  termin_beginn: z.string().datetime({ offset: true }).nullable().optional(),
  termin_art: z.enum(TERMIN_ART_WERTE).optional(),
});

export async function stufeSetzen(
  id: string,
  eingabe: {
    stufe: Stufe;
    angebotswert?: number | null;
    auftragswert?: number | null;
    verlust_grund?: VerlustGrund | null;
    verlust_notiz?: string | null;
    /** Nur bei „Termin vor Ort“: Beginn (ISO) und Art des Termins */
    termin_beginn?: string | null;
    termin_art?: TerminArt;
  }
): Promise<Ergebnis<Lead>> {
  const { companyId, profile } = await requireKunde();
  try {
    const v = stufeSchema.parse({ id, ...eingabe });
    if (v.stufe === "termin" && v.termin_beginn) {
      // Termin zuerst anlegen: schlägt das fehl, bleibt auch die Stufe unverändert
      const db0 = createAdminClient();
      if (!(await gehoertZurFirma(db0, v.id, companyId))) return { data: null, error: "Lead nicht gefunden" };
      const t = await terminEinfuegen(db0, {
        leadId: v.id,
        companyId,
        userId: profile.id,
        beginn: v.termin_beginn,
        art: v.termin_art ?? "vor_ort",
      });
      if (t.error) return { data: null, error: t.error };
    }
    const pruefung = pruefeStufenWechsel(v);
    if (pruefung) return { data: null, error: pruefung };

    const db = createAdminClient();
    const { data: aktuell } = await db
      .from("leads")
      .select("status")
      .eq("id", v.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!aktuell) return { data: null, error: "Lead nicht gefunden" };
    const altStatus = (aktuell as { status: LeadStatus }).status;
    const altStufe = stufeVon(altStatus);

    const payload: Record<string, unknown> = {};
    // Gleiche Stufe (z. B. termin_vereinbart → Termin vor Ort): Status bleibt, nur Werte ändern
    if (altStufe !== v.stufe) {
      payload.status = statusFuerStufe(v.stufe);
      payload.geaendert_von = profile.id;
    }
    if (v.stufe === "angebot" && v.angebotswert != null) payload.angebotswert = v.angebotswert;
    if (v.stufe === "auftrag") payload.auftragswert = v.auftragswert;
    if (v.stufe === "verloren") {
      payload.verlust_grund = v.verlust_grund;
      payload.verlust_notiz = v.verlust_notiz?.trim() || null;
    } else if (altStufe === "verloren") {
      payload.verlust_grund = null;
      payload.verlust_notiz = null;
    }
    if (stufenInfo(v.stufe).abschluss) payload.naechste_aktion_am = null;
    if (Object.keys(payload).length === 0) {
      neuLaden(v.id);
      return { data: null, error: null };
    }

    const { data: lead, error } = await db
      .from("leads")
      .update(payload)
      .eq("id", v.id)
      .eq("company_id", companyId)
      .select()
      .single();
    if (error) return { data: null, error: error.message };

    neuLaden(v.id);
    return { data: lead as Lead, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

/** Alte Schnittstelle (Status direkt) — protokolliert ebenfalls nur über den Trigger. */
export async function updateLeadStatus(
  id: string,
  data: { status: LeadStatus; auftragswert?: number; verlust_grund?: VerlustGrund }
): Promise<Ergebnis<Lead>> {
  const { companyId, profile } = await requireKunde();
  try {
    const v = z
      .object({
        id: uuid,
        status: z.enum(LEAD_STATUS),
        auftragswert: z.number().positive().optional(),
        verlust_grund: z.enum(VERLUST_WERTE).optional(),
      })
      .parse({ id, ...data });
    if (v.status === "gewonnen" && !v.auftragswert) {
      return { data: null, error: "Auftragswert ist beim Auftrag erforderlich." };
    }
    if (v.status === "verloren" && !v.verlust_grund) {
      return { data: null, error: "Grund ist bei „Verloren“ erforderlich." };
    }
    const db = createAdminClient();
    const payload: Record<string, unknown> = { status: v.status, geaendert_von: profile.id };
    if (v.auftragswert !== undefined) payload.auftragswert = v.auftragswert;
    if (v.verlust_grund !== undefined) payload.verlust_grund = v.verlust_grund;

    const { data: lead, error } = await db
      .from("leads")
      .update(payload)
      .eq("id", v.id)
      .eq("company_id", companyId)
      .select()
      .single();
    if (error) return { data: null, error: error.message };
    neuLaden(v.id);
    return { data: lead as Lead, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

// ---------------------------------------------------------------------------
// Kontakt: Anrufen / WhatsApp / Ergebnis
// ---------------------------------------------------------------------------

async function erstkontaktSetzen(db: Db, leadId: string, companyId: string) {
  await db
    .from("leads")
    .update({ first_contact_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("company_id", companyId)
    .is("first_contact_at", null);
}

/** Knopf „Anrufen“ / „WhatsApp“: Aktivität + first_contact_at (falls leer). */
export async function kontaktProtokollieren(
  id: string,
  kanal: "anruf" | "whatsapp"
): Promise<Ergebnis<true>> {
  const { companyId, profile } = await requireKunde();
  try {
    const leadId = uuid.parse(id);
    const k = z.enum(["anruf", "whatsapp"]).parse(kanal);
    const db = createAdminClient();
    if (!(await gehoertZurFirma(db, leadId, companyId))) return { data: null, error: "Lead nicht gefunden" };

    await erstkontaktSetzen(db, leadId, companyId);
    await versuchStarten(db, { leadId, companyId, userId: profile.id, kanal: k });
    // Texte bewusst anders als vor 00018 („Angerufen“), damit die Altdaten-Übernahme nichts doppelt zählt
    await aktivitaet(db, leadId, profile.id, k, k === "anruf" ? "Anruf gestartet" : "WhatsApp gestartet");
    neuLaden(leadId);
    return { data: true, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

const ERGEBNIS_TEXT: Record<AnrufErgebnis, (versuch: number) => string> = {
  erreicht: () => "Anruf: erreicht",
  rueckruf_gewuenscht: () => "Anruf: erreicht – Rückruf gewünscht",
  nicht_erreicht: (n) => `Anruf: nicht erreicht (${n}. Versuch)`,
  mailbox: (n) => `Anruf: Mailbox (${n}. Versuch)`,
  falsche_nummer: () => "Anruf: falsche Nummer",
};

/**
 * Ergebnis eines Anrufs (1 Tipp): Kontaktversuch mit Ergebnis speichern (lead_anrufe),
 * Erreicht/Rückruf gewünscht → Neu wird Kontaktiert und der fällige Rückruf ist erledigt,
 * sonst +1 Versuch. Optional gleich einen Rückruf setzen (null = keinen).
 */
export async function anrufErgebnis(
  id: string,
  ergebnis: AnrufErgebnis,
  rueckrufIso?: string | null
): Promise<Ergebnis<{ versuche: number; erreicht: boolean }>> {
  const { companyId, profile } = await requireKunde();
  try {
    const leadId = uuid.parse(id);
    const erg = z.enum(ANRUF_ERGEBNIS_WERTE).parse(ergebnis);
    const rueckruf = z.string().datetime({ offset: true }).nullable().optional().parse(rueckrufIso);
    const db = createAdminClient();
    const { data } = await db
      .from("leads")
      .select("status, naechste_aktion_am, kontakt_versuche")
      .eq("id", leadId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!data) return { data: null, error: "Lead nicht gefunden" };
    const lead = data as Pick<Lead, "status" | "naechste_aktion_am" | "kontakt_versuche">;
    const ok = istErreicht(erg);

    await erstkontaktSetzen(db, leadId, companyId);
    const payload: Record<string, unknown> = {};
    let versuche = lead.kontakt_versuche ?? 0;
    if (ok) {
      if (lead.status === "neu") {
        payload.status = "kontaktiert";
        payload.geaendert_von = profile.id;
      }
      if (lead.naechste_aktion_am && new Date(lead.naechste_aktion_am) < heuteEnde()) {
        payload.naechste_aktion_am = null;
      }
    } else {
      versuche += 1;
      payload.kontakt_versuche = versuche;
    }
    if (rueckruf !== undefined) payload.naechste_aktion_am = rueckruf;
    if (Object.keys(payload).length > 0) {
      const { error } = await db.from("leads").update(payload).eq("id", leadId).eq("company_id", companyId);
      if (error) return { data: null, error: error.message };
    }

    await ergebnisEintragen(db, { leadId, companyId, userId: profile.id, ergebnis: erg });
    const text = ERGEBNIS_TEXT[erg](versuche) + (rueckruf ? ` – Rückruf ${zeitpunktText(rueckruf)}` : "");
    await aktivitaet(db, leadId, profile.id, ok ? "anruf" : "nicht_erreicht", text);
    neuLaden(leadId);
    return { data: { versuche, erreicht: ok }, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

/** „Erreicht“: Neu → Kontaktiert, fälliger Rückruf erledigt. */
export async function erreicht(id: string): Promise<Ergebnis<true>> {
  const res = await anrufErgebnis(id, "erreicht");
  return res.error ? { data: null, error: res.error } : { data: true, error: null };
}

/** „Nicht erreicht“: +1 Versuch, Aktivität, optional neuer Rückruf (null = keiner). */
export async function nichtErreicht(id: string, rueckrufIso?: string | null): Promise<Ergebnis<number>> {
  const res = await anrufErgebnis(id, "nicht_erreicht", rueckrufIso);
  return res.error ? { data: null, error: res.error } : { data: res.data?.versuche ?? 0, error: null };
}

// ---------------------------------------------------------------------------
// Rückruf, Notiz, Zuständig
// ---------------------------------------------------------------------------

/** Rückruf planen (ISO) oder löschen (null). */
export async function rueckrufSetzen(id: string, iso: string | null): Promise<Ergebnis<true>> {
  const { companyId, profile } = await requireKunde();
  try {
    const leadId = uuid.parse(id);
    const zeit = z.string().datetime({ offset: true }).nullable().parse(iso);
    const db = createAdminClient();
    const { data, error } = await db
      .from("leads")
      .update({ naechste_aktion_am: zeit })
      .eq("id", leadId)
      .eq("company_id", companyId)
      .select("id")
      .maybeSingle();
    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: "Lead nicht gefunden" };

    await aktivitaet(db, leadId, profile.id, "rueckruf", zeit ? `Rückruf geplant: ${zeitpunktText(zeit)}` : "Rückruf gelöscht");
    neuLaden(leadId);
    return { data: true, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

const addLeadActivitySchema = z.object({
  leadId: uuid,
  typ: z.enum(["anruf", "notiz", "email", "whatsapp"]),
  inhalt: z.string().trim().min(1, "Bitte etwas eintragen").max(5000),
});

export async function addLeadActivity(
  leadId: string,
  data: { typ: LeadActivityTyp; inhalt: string }
): Promise<Ergebnis<LeadActivity>> {
  const { companyId, profile } = await requireKunde();
  try {
    const v = addLeadActivitySchema.parse({ leadId, ...data });
    const db = createAdminClient();
    if (!(await gehoertZurFirma(db, v.leadId, companyId))) return { data: null, error: "Lead nicht gefunden" };

    const { data: activity, error } = await db
      .from("lead_activities")
      .insert({ lead_id: v.leadId, user_id: profile.id, typ: v.typ, inhalt: v.inhalt, alt_status: null, neu_status: null })
      .select()
      .single();
    if (error) return { data: null, error: error.message };
    neuLaden(v.leadId);
    return { data: activity as LeadActivity, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

/** Nur aktive Profile DERSELBEN Firma (kein Team-Mitglied). null = niemand. */
export async function zustaendigSetzen(id: string, profileId: string | null): Promise<Ergebnis<true>> {
  const { companyId, profile } = await requireKunde();
  try {
    const leadId = uuid.parse(id);
    const ziel = uuid.nullable().parse(profileId);
    const db = createAdminClient();

    let name = "niemand";
    if (ziel) {
      const { data: person } = await db
        .from("profiles")
        .select("id, full_name")
        .eq("id", ziel)
        .eq("company_id", companyId)
        .eq("active", true)
        .maybeSingle();
      if (!person) return { data: null, error: "Person gehört nicht zu dieser Firma" };
      name = (person as { full_name: string | null }).full_name || "ohne Namen";
    }

    const { data, error } = await db
      .from("leads")
      .update({ assigned_to: ziel })
      .eq("id", leadId)
      .eq("company_id", companyId)
      .select("id")
      .maybeSingle();
    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: "Lead nicht gefunden" };

    await aktivitaet(db, leadId, profile.id, "notiz", `Zuständig: ${name}`);
    neuLaden(leadId);
    return { data: true, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

const updateLeadDetailsSchema = z.object({
  id: uuid,
  angebotswert: z.number().nonnegative().optional(),
  naechste_aktion_am: z.string().datetime({ offset: true }).optional(),
  assigned_to: uuid.optional(),
});

export async function updateLeadDetails(
  id: string,
  data: { angebotswert?: number; naechste_aktion_am?: string; assigned_to?: string }
): Promise<Ergebnis<Lead>> {
  const { companyId } = await requireKunde();
  try {
    const v = updateLeadDetailsSchema.parse({ id, ...data });
    const db = createAdminClient();

    const payload: Record<string, unknown> = {};
    if (v.angebotswert !== undefined) payload.angebotswert = v.angebotswert;
    if (v.naechste_aktion_am !== undefined) payload.naechste_aktion_am = v.naechste_aktion_am;
    if (v.assigned_to !== undefined) {
      // Nur Personen derselben Firma zuweisen
      const { data: person } = await db
        .from("profiles")
        .select("id")
        .eq("id", v.assigned_to)
        .eq("company_id", companyId)
        .eq("active", true)
        .maybeSingle();
      if (!person) return { data: null, error: "Person gehört nicht zu dieser Firma" };
      payload.assigned_to = v.assigned_to;
    }

    const { data: lead, error } = await db
      .from("leads")
      .update(payload)
      .eq("id", v.id)
      .eq("company_id", companyId)
      .select()
      .single();
    if (error) return { data: null, error: error.message };
    neuLaden(v.id);
    return { data: lead as Lead, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

/** Älterer Knopf „Als kontaktiert markieren“ (Status-Verlauf über den Trigger). */
export async function markAsContacted(id: string): Promise<Ergebnis<true>> {
  return erreicht(id);
}

// ---------------------------------------------------------------------------
// Lead von Hand anlegen
// ---------------------------------------------------------------------------

const MANUELLE_QUELLEN = ["manuell", "empfehlung"] as const;

const createLeadSchema = z.object({
  name: z.string().trim().max(200).optional(),
  vorname: z.string().trim().max(100).optional(),
  nachname: z.string().trim().max(100).optional(),
  telefon: z.string().trim().max(40).optional(),
  email: z.string().trim().email("Ungültige E-Mail-Adresse").optional().or(z.literal("")),
  plz: z.string().trim().max(10).optional(),
  ort: z.string().trim().max(100).optional(),
  anliegen: z.string().trim().max(2000).optional(),
  quelle: z.enum(["google_ads", "onepage", ...MANUELLE_QUELLEN]).optional(),
});

/** company_id aus dem Formular wird ignoriert — es zählt immer die Firma des Kontexts. */
export async function createLead(data: {
  company_id?: string;
  name?: string;
  vorname?: string;
  nachname?: string;
  telefon?: string;
  email?: string;
  plz?: string;
  ort?: string;
  anliegen?: string;
  quelle?: LeadQuelle;
}): Promise<Ergebnis<Lead>> {
  const { companyId, profile } = await requireKunde();
  try {
    const v = createLeadSchema.parse({ ...data, company_id: undefined });
    const ausName = v.name ? teileName(v.name) : null;
    const vorname = ausName?.vorname || v.vorname || "";
    const nachname = ausName?.nachname ?? v.nachname ?? "";
    if (!vorname && !nachname) return { data: null, error: "Bitte einen Namen eintragen" };
    if (!v.telefon && !v.email) return { data: null, error: "Bitte eine Telefonnummer eintragen" };

    const db = createAdminClient();
    const { data: newLead, error } = await db
      .from("leads")
      .insert({
        company_id: companyId,
        vorname,
        nachname,
        telefon: v.telefon || null,
        email: v.email || null,
        plz: v.plz || null,
        ort: v.ort || null,
        anliegen: v.anliegen || null,
        quelle: v.quelle ?? "manuell",
        status: "neu",
        assigned_to: profile.company_id === companyId ? profile.id : null,
      })
      .select()
      .single();
    if (error) return { data: null, error: error.message };

    const lead = newLead as Lead;
    await aktivitaet(db, lead.id, profile.id, "notiz", "Von Hand angelegt");
    neuLaden(lead.id);
    return { data: lead, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}
