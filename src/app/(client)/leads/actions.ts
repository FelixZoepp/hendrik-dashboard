"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import type {
  Lead,
  LeadActivity,
  LeadStatus,
  LeadActivityTyp,
  VerlustGrund,
  LeadQuelle,
} from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCurrentProfile() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Nicht authentifiziert");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Profil nicht gefunden");
  }

  return { user, profile: profile as { id: string; company_id: string | null; role: string } };
}

async function isStaff(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_staff");
  return data === true;
}

// ---------------------------------------------------------------------------
// 1. getLeads
// ---------------------------------------------------------------------------

const getLeadsFiltersSchema = z
  .object({
    status: z
      .enum([
        "neu",
        "kontaktiert",
        "termin_vereinbart",
        "vor_ort_termin",
        "angebot_raus",
        "gewonnen",
        "verloren",
        "kein_interesse",
        "nicht_erreicht",
      ])
      .optional(),
    search: z.string().optional(),
    company_id: z.string().uuid().optional(),
  })
  .optional();

export async function getLeads(
  filters?: { status?: LeadStatus; search?: string; company_id?: string }
): Promise<{ data: (Lead & { company_name: string })[] | null; error: string | null }> {
  try {
    const parsed = getLeadsFiltersSchema.parse(filters);
    const supabase = await createClient();
    const { profile } = await getCurrentProfile();
    const staff = await isStaff();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
    let query = supabase
      .from("leads")
      .select("*, companies!inner(name)")
      .order("created_at", { ascending: false }) as any;

    // Scope: clients see only their company's leads, staff sees all
    if (!staff) {
      if (!profile.company_id) {
        return { data: [], error: null };
      }
      query = query.eq("company_id", profile.company_id);
    } else if (parsed?.company_id) {
      query = query.eq("company_id", parsed.company_id);
    }

    if (parsed?.status) {
      query = query.eq("status", parsed.status);
    }

    if (parsed?.search) {
      const term = `%${parsed.search}%`;
      query = query.or(
        `vorname.ilike.${term},nachname.ilike.${term},email.ilike.${term},telefon.ilike.${term},ort.ilike.${term}`
      );
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error: error.message };
    }

    type LeadWithCompany = Lead & { companies: { name: string } };

    // Flatten the joined company name
    const leads = ((data ?? []) as LeadWithCompany[]).map((row) => {
      const { companies, ...lead } = row;
      return { ...lead, company_name: companies.name };
    });

    return { data: leads, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { data: null, error: message };
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
  try {
    const validId = getLeadSchema.parse(id);
    const supabase = await createClient();

    // Fetch lead with company name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
    const { data: leadRow, error: leadError } = await (supabase
      .from("leads")
      .select("*, companies!inner(name)")
      .eq("id", validId)
      .single() as any);

    if (leadError) {
      return { data: null, error: (leadError as { message: string }).message };
    }

    // Fetch activities
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
    const { data: activities, error: activitiesError } = await (supabase
      .from("lead_activities")
      .select("*")
      .eq("lead_id", validId)
      .order("created_at", { ascending: false }) as any);

    if (activitiesError) {
      return { data: null, error: (activitiesError as { message: string }).message };
    }

    const typedRow = leadRow as Lead & { companies: { name: string } };
    const { companies, ...lead } = typedRow;

    return {
      data: {
        ...lead,
        company_name: companies.name,
        activities: (activities ?? []) as LeadActivity[],
      },
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { data: null, error: message };
  }
}

// ---------------------------------------------------------------------------
// 3. updateLeadStatus
// ---------------------------------------------------------------------------

const updateLeadStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum([
    "neu",
    "kontaktiert",
    "termin_vereinbart",
    "vor_ort_termin",
    "angebot_raus",
    "gewonnen",
    "verloren",
    "kein_interesse",
    "nicht_erreicht",
  ]),
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
  try {
    const validated = updateLeadStatusSchema.parse({ id, ...data });

    // Business rules
    if (validated.status === "gewonnen" && !validated.auftragswert) {
      return { data: null, error: "Auftragswert ist bei Status 'gewonnen' erforderlich." };
    }
    if (validated.status === "verloren" && !validated.verlust_grund) {
      return { data: null, error: "Verlustgrund ist bei Status 'verloren' erforderlich." };
    }

    const supabase = await createClient();

    // Get current status for the activity log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
    const { data: currentLead } = await (supabase
      .from("leads")
      .select("status")
      .eq("id", validated.id)
      .single() as any) as { data: { status: LeadStatus } | null };

    const updatePayload: Record<string, unknown> = {
      status: validated.status,
      updated_at: new Date().toISOString(),
    };

    if (validated.auftragswert !== undefined) {
      updatePayload.auftragswert = validated.auftragswert;
    }
    if (validated.verlust_grund !== undefined) {
      updatePayload.verlust_grund = validated.verlust_grund;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
    const { data: updatedLead, error } = await (supabase
      .from("leads") as any)
      .update(updatePayload)
      .eq("id", validated.id)
      .select()
      .single();

    if (error) {
      return { data: null, error: (error as { message: string }).message };
    }

    // Log the status change as activity
    const { user } = await getCurrentProfile();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
    await (supabase.from("lead_activities") as any).insert({
      lead_id: validated.id,
      user_id: user.id,
      typ: "status_wechsel" as LeadActivityTyp,
      inhalt: `Status: ${currentLead?.status ?? "unbekannt"} \u2192 ${validated.status}`,
      alt_status: currentLead?.status ?? null,
      neu_status: validated.status,
    });

    revalidatePath("/leads", "page");
    return { data: updatedLead as Lead, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { data: null, error: message };
  }
}

// ---------------------------------------------------------------------------
// 4. markAsContacted
// ---------------------------------------------------------------------------

const markAsContactedSchema = z.string().uuid();

export async function markAsContacted(
  id: string
): Promise<{ data: Lead | null; error: string | null }> {
  try {
    const validId = markAsContactedSchema.parse(id);
    const supabase = await createClient();

    // Only update if first_contact_at is not already set
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
    const { data: currentLead, error: fetchError } = await (supabase
      .from("leads")
      .select("first_contact_at, status")
      .eq("id", validId)
      .single() as any) as {
      data: { first_contact_at: string | null; status: LeadStatus } | null;
      error: { message: string } | null;
    };

    if (fetchError) {
      return { data: null, error: fetchError.message };
    }

    if (!currentLead) {
      return { data: null, error: "Lead nicht gefunden" };
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (!currentLead.first_contact_at) {
      updatePayload.first_contact_at = new Date().toISOString();
    }

    if (currentLead.status === "neu") {
      updatePayload.status = "kontaktiert";
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
    const { data: updatedLead, error } = await (supabase
      .from("leads") as any)
      .update(updatePayload)
      .eq("id", validId)
      .select()
      .single();

    if (error) {
      return { data: null, error: (error as { message: string }).message };
    }

    // Log activity if status changed
    if (currentLead.status === "neu") {
      const { user } = await getCurrentProfile();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
      await (supabase.from("lead_activities") as any).insert({
        lead_id: validId,
        user_id: user.id,
        typ: "status_wechsel" as LeadActivityTyp,
        inhalt: "Status: neu \u2192 kontaktiert",
        alt_status: "neu" as LeadStatus,
        neu_status: "kontaktiert" as LeadStatus,
      });
    }

    revalidatePath("/leads", "page");
    return { data: updatedLead as Lead, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { data: null, error: message };
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
  try {
    const validated = addLeadActivitySchema.parse({ leadId, ...data });
    const supabase = await createClient();
    const { user } = await getCurrentProfile();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
    const { data: activity, error } = await (supabase
      .from("lead_activities") as any)
      .insert({
        lead_id: validated.leadId,
        user_id: user.id,
        typ: validated.typ,
        inhalt: validated.inhalt,
        alt_status: null,
        neu_status: null,
      })
      .select()
      .single();

    if (error) {
      return { data: null, error: (error as { message: string }).message };
    }

    revalidatePath("/leads", "page");
    return { data: activity as LeadActivity, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { data: null, error: message };
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
  try {
    const validated = updateLeadDetailsSchema.parse({ id, ...data });

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (validated.angebotswert !== undefined) {
      updatePayload.angebotswert = validated.angebotswert;
    }
    if (validated.naechste_aktion_am !== undefined) {
      updatePayload.naechste_aktion_am = validated.naechste_aktion_am;
    }
    if (validated.assigned_to !== undefined) {
      updatePayload.assigned_to = validated.assigned_to;
    }

    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
    const { data: updatedLead, error } = await (supabase
      .from("leads") as any)
      .update(updatePayload)
      .eq("id", validated.id)
      .select()
      .single();

    if (error) {
      return { data: null, error: (error as { message: string }).message };
    }

    revalidatePath("/leads", "page");
    return { data: updatedLead as Lead, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { data: null, error: message };
  }
}

// ---------------------------------------------------------------------------
// 7. createLead
// ---------------------------------------------------------------------------

const createLeadSchema = z.object({
  company_id: z.string().uuid(),
  vorname: z.string().min(1, "Vorname ist erforderlich"),
  nachname: z.string().min(1, "Nachname ist erforderlich"),
  telefon: z.string().optional(),
  email: z.string().email("Ungültige E-Mail-Adresse").optional().or(z.literal("")),
  plz: z.string().optional(),
  ort: z.string().optional(),
  anliegen: z.string().optional(),
  quelle: z.enum(["google_ads", "onepage", "manuell", "empfehlung"]).optional(),
});

export async function createLead(
  data: {
    company_id: string;
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
  try {
    const validated = createLeadSchema.parse(data);
    const supabase = await createClient();
    const { user } = await getCurrentProfile();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-ssr generic limitation
    const { data: newLead, error } = await (supabase
      .from("leads") as any)
      .insert({
        company_id: validated.company_id,
        vorname: validated.vorname,
        nachname: validated.nachname,
        telefon: validated.telefon ?? null,
        email: validated.email && validated.email !== "" ? validated.email : null,
        plz: validated.plz ?? null,
        ort: validated.ort ?? null,
        anliegen: validated.anliegen ?? null,
        quelle: validated.quelle ?? "manuell",
        campaign: null,
        form_payload: null,
        first_contact_at: null,
        status: "neu",
        assigned_to: user.id,
        angebotswert: null,
        auftragswert: null,
        verlust_grund: null,
        naechste_aktion_am: null,
      })
      .select()
      .single();

    if (error) {
      return { data: null, error: (error as { message: string }).message };
    }

    revalidatePath("/leads", "page");
    return { data: newLead as Lead, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { data: null, error: message };
  }
}
