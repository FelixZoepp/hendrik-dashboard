"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { z } from "zod";
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

type Db = ReturnType<typeof createAdminClient>;

async function gehoertZurFirma(db: Db, leadId: string, companyId: string) {
  const { data } = await db.from("leads").select("id").eq("id", leadId).eq("company_id", companyId).maybeSingle();
  return !!data;
}

function fehlerText(err: unknown) {
  return err instanceof Error ? err.message : "Unbekannter Fehler";
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

// ---------------------------------------------------------------------------
// 1. getLeads
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

    if (parsed?.status) {
      query = query.eq("status", parsed.status);
    }

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

// ---------------------------------------------------------------------------
// 2. getLead
// ---------------------------------------------------------------------------

const getLeadSchema = z.string().uuid();

export async function getLead(
  id: string
): Promise<{
  data: (Lead & { company_name: string; activities: LeadActivity[] }) | null;
  error: string | null;
}> {
  const { companyId } = await requireKunde();
  try {
    const validId = getLeadSchema.parse(id);
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
      data: {
        ...lead,
        company_name: companies.name,
        activities: (activities ?? []) as LeadActivity[],
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

// ---------------------------------------------------------------------------
// 3. updateLeadStatus
// ---------------------------------------------------------------------------

const updateLeadStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(LEAD_STATUS),
  auftragswert: z.number().positive().optional(),
  verlust_grund: z
    .enum([
      "zu_teuer",
      "kein_bedarf_mehr",
      "anderer_anbieter",
      "nicht_erreicht",
      "unpassende_anfrage",
    ])
    .optional(),
});

export async function updateLeadStatus(
  id: string,
  data: { status: LeadStatus; auftragswert?: number; verlust_grund?: VerlustGrund }
): Promise<{ data: Lead | null; error: string | null }> {
  const { companyId, profile } = await requireKunde();
  try {
    const validated = updateLeadStatusSchema.parse({ id, ...data });

    if (validated.status === "gewonnen" && !validated.auftragswert) {
      return { data: null, error: "Auftragswert ist bei Status 'gewonnen' erforderlich." };
    }
    if (validated.status === "verloren" && !validated.verlust_grund) {
      return { data: null, error: "Verlustgrund ist bei Status 'verloren' erforderlich." };
    }

    const supabase = createAdminClient();

    const { data: currentLead } = await supabase
      .from("leads")
      .select("status")
      .eq("id", validated.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!currentLead) return { data: null, error: "Lead nicht gefunden" };
    const altStatus = (currentLead as { status: LeadStatus }).status;

    const updatePayload: Record<string, unknown> = {
      status: validated.status,
      updated_at: new Date().toISOString(),
    };
    if (validated.auftragswert !== undefined) updatePayload.auftragswert = validated.auftragswert;
    if (validated.verlust_grund !== undefined) updatePayload.verlust_grund = validated.verlust_grund;

    const { data: updatedLead, error } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", validated.id)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) return { data: null, error: error.message };

    await supabase.from("lead_activities").insert({
      lead_id: validated.id,
      user_id: profile.id,
      typ: "status_wechsel" as LeadActivityTyp,
      inhalt: `Status: ${altStatus} → ${validated.status}`,
      alt_status: altStatus,
      neu_status: validated.status,
    });

    revalidatePath("/leads", "page");
    return { data: updatedLead as Lead, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

// ---------------------------------------------------------------------------
// 4. markAsContacted
// ---------------------------------------------------------------------------

const markAsContactedSchema = z.string().uuid();

export async function markAsContacted(
  id: string
): Promise<{ data: Lead | null; error: string | null }> {
  const { companyId, profile } = await requireKunde();
  try {
    const validId = markAsContactedSchema.parse(id);
    const supabase = createAdminClient();

    const { data: row, error: fetchError } = await supabase
      .from("leads")
      .select("first_contact_at, status")
      .eq("id", validId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (fetchError) return { data: null, error: fetchError.message };
    if (!row) return { data: null, error: "Lead nicht gefunden" };
    const currentLead = row as { first_contact_at: string | null; status: LeadStatus };

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (!currentLead.first_contact_at) updatePayload.first_contact_at = new Date().toISOString();
    if (currentLead.status === "neu") updatePayload.status = "kontaktiert";

    const { data: updatedLead, error } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", validId)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) return { data: null, error: error.message };

    if (currentLead.status === "neu") {
      await supabase.from("lead_activities").insert({
        lead_id: validId,
        user_id: profile.id,
        typ: "status_wechsel" as LeadActivityTyp,
        inhalt: "Status: neu → kontaktiert",
        alt_status: "neu" as LeadStatus,
        neu_status: "kontaktiert" as LeadStatus,
      });
    }

    revalidatePath("/leads", "page");
    return { data: updatedLead as Lead, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

// ---------------------------------------------------------------------------
// 5. addLeadActivity
// ---------------------------------------------------------------------------

const addLeadActivitySchema = z.object({
  leadId: z.string().uuid(),
  typ: z.enum(["anruf", "notiz", "status_wechsel", "email", "whatsapp"]),
  inhalt: z.string().min(1, "Inhalt darf nicht leer sein"),
});

export async function addLeadActivity(
  leadId: string,
  data: { typ: LeadActivityTyp; inhalt: string }
): Promise<{ data: LeadActivity | null; error: string | null }> {
  const { companyId, profile } = await requireKunde();
  try {
    const validated = addLeadActivitySchema.parse({ leadId, ...data });
    const supabase = createAdminClient();
    if (!(await gehoertZurFirma(supabase, validated.leadId, companyId))) {
      return { data: null, error: "Lead nicht gefunden" };
    }

    const { data: activity, error } = await supabase
      .from("lead_activities")
      .insert({
        lead_id: validated.leadId,
        user_id: profile.id,
        typ: validated.typ,
        inhalt: validated.inhalt,
        alt_status: null,
        neu_status: null,
      })
      .select()
      .single();

    if (error) return { data: null, error: error.message };

    revalidatePath("/leads", "page");
    return { data: activity as LeadActivity, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

// ---------------------------------------------------------------------------
// 6. updateLeadDetails
// ---------------------------------------------------------------------------

const updateLeadDetailsSchema = z.object({
  id: z.string().uuid(),
  angebotswert: z.number().nonnegative().optional(),
  naechste_aktion_am: z.string().datetime().optional(),
  assigned_to: z.string().uuid().optional(),
});

export async function updateLeadDetails(
  id: string,
  data: { angebotswert?: number; naechste_aktion_am?: string; assigned_to?: string }
): Promise<{ data: Lead | null; error: string | null }> {
  const { companyId } = await requireKunde();
  try {
    const validated = updateLeadDetailsSchema.parse({ id, ...data });
    const supabase = createAdminClient();

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (validated.angebotswert !== undefined) updatePayload.angebotswert = validated.angebotswert;
    if (validated.naechste_aktion_am !== undefined) updatePayload.naechste_aktion_am = validated.naechste_aktion_am;
    if (validated.assigned_to !== undefined) {
      // Nur Personen derselben Firma (oder Team) zuweisen
      const { data: person } = await supabase
        .from("profiles")
        .select("id, role, company_id")
        .eq("id", validated.assigned_to)
        .maybeSingle();
      const p = person as { role: string; company_id: string | null } | null;
      if (!p || (p.company_id !== companyId && !["admin", "sales", "fulfillment"].includes(p.role))) {
        return { data: null, error: "Person gehört nicht zu dieser Firma" };
      }
      updatePayload.assigned_to = validated.assigned_to;
    }

    const { data: updatedLead, error } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", validated.id)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) return { data: null, error: error.message };

    revalidatePath("/leads", "page");
    return { data: updatedLead as Lead, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}

// ---------------------------------------------------------------------------
// 7. createLead
// ---------------------------------------------------------------------------

const createLeadSchema = z.object({
  vorname: z.string().min(1, "Vorname ist erforderlich"),
  nachname: z.string().min(1, "Nachname ist erforderlich"),
  telefon: z.string().optional(),
  email: z.string().email("Ungültige E-Mail-Adresse").optional().or(z.literal("")),
  plz: z.string().optional(),
  ort: z.string().optional(),
  anliegen: z.string().optional(),
  quelle: z.enum(["google_ads", "onepage", "manuell", "empfehlung"]).optional(),
});

/** company_id aus dem Formular wird ignoriert — es zählt immer die Firma des Kontexts. */
export async function createLead(
  data: {
    company_id?: string;
    vorname: string;
    nachname: string;
    telefon?: string;
    email?: string;
    plz?: string;
    ort?: string;
    anliegen?: string;
    quelle?: LeadQuelle;
  }
): Promise<{ data: Lead | null; error: string | null }> {
  const { companyId, profile } = await requireKunde();
  try {
    const validated = createLeadSchema.parse(data);
    const supabase = createAdminClient();

    const { data: newLead, error } = await supabase
      .from("leads")
      .insert({
        company_id: companyId,
        vorname: validated.vorname,
        nachname: validated.nachname,
        telefon: validated.telefon ?? null,
        email: validated.email && validated.email !== "" ? validated.email : null,
        plz: validated.plz ?? null,
        ort: validated.ort ?? null,
        anliegen: validated.anliegen ?? null,
        quelle: validated.quelle ?? "manuell",
        status: "neu",
        assigned_to: profile.id,
      })
      .select()
      .single();

    if (error) return { data: null, error: error.message };

    revalidatePath("/leads", "page");
    return { data: newLead as Lead, error: null };
  } catch (err) {
    return { data: null, error: fehlerText(err) };
  }
}
