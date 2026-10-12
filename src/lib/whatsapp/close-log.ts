import type { SupabaseClient } from "@supabase/supabase-js";
import { closeApi, closeUserName, type CloseUser } from "@/lib/integrations/close";
import { berlinDatum, normalisiereTelefon } from "./logik";

/**
 * Close-Anbindung des WhatsApp-Terminbots: Notizen und Aufgaben am Lead,
 * Lead-Suche per E-Mail/Telefon. Notizen/Aufgaben laufen immer (auch wenn der
 * Bot aus ist) — sie gehen nur an das eigene Team, nie an den Lead.
 */

/** Notiz am Close-Lead (best effort — Fehler werden geworfen, Aufrufer fängt). */
export async function notizAnLead(leadId: string | null | undefined, text: string): Promise<void> {
  if (!leadId) return;
  await closeApi("/activity/note/", { method: "POST", body: { lead_id: leadId, note: text } });
}

/** Notiz ohne Fehlerweitergabe (für Protokollzwecke). */
export async function notizSicher(leadId: string | null | undefined, text: string): Promise<void> {
  try {
    await notizAnLead(leadId, text);
  } catch (err) {
    console.error("[whatsapp] Close-Notiz fehlgeschlagen:", err);
  }
}

/**
 * Aufgabe am Close-Lead. Doppelte offene Aufgabe mit gleichem Text am gleichen Tag
 * wird nicht angelegt (max. 1 pro Lead/Tag). Rückgabe: Aufgaben-ID oder null.
 */
export async function aufgabeAnLead(
  leadId: string | null | undefined,
  text: string,
  opts: { datum?: string; zustaendig?: string | null } = {},
): Promise<string | null> {
  if (!leadId) return null;
  const datum = opts.datum ?? berlinDatum(new Date());
  const { data: offene } = await closeApi<{ data: Array<{ text: string; date: string | null }> }>("/task/", {
    params: { lead_id: leadId, is_complete: "false", _fields: "text,date" },
  });
  if (offene.some((t) => t.text === text && t.date?.slice(0, 10) === datum.slice(0, 10))) return null;
  const aufgabe = await closeApi<{ id: string }>("/task/", {
    method: "POST",
    body: {
      _type: "lead",
      lead_id: leadId,
      text,
      date: datum,
      ...(opts.zustaendig ? { assigned_to: opts.zustaendig } : {}),
    },
  });
  return aufgabe.id;
}

interface LeadKontakt {
  name?: string | null;
  emails?: Array<{ email: string }>;
  phones?: Array<{ phone: string }>;
  [feld: string]: unknown;
}

export interface CloseLeadDaten {
  id: string;
  display_name?: string;
  contacts?: LeadKontakt[];
  custom?: Record<string, unknown>;
  [feld: string]: unknown;
}

export async function ladeLead(leadId: string): Promise<CloseLeadDaten> {
  return closeApi<CloseLeadDaten>(`/lead/${leadId}/`);
}

/** Name einer Close-Benutzer-ID (für den Gastgeber). */
export async function closeBenutzerName(svc: SupabaseClient, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await svc.from("close_users").select("name").eq("close_id", userId).maybeSingle();
  if ((data as { name?: string } | null)?.name) return (data as { name: string }).name;
  try {
    return closeUserName(await closeApi<CloseUser>(`/user/${userId}/`));
  } catch {
    return null;
  }
}

/** Close-Benutzer-ID zu einer E-Mail (Calendly-Gastgeber → Aufgaben-Zuständigkeit). */
export async function closeBenutzerPerEmail(svc: SupabaseClient, email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const { data } = await svc.from("close_users").select("close_id").ilike("email", email).limit(1).maybeSingle();
  return (data as { close_id?: string } | null)?.close_id ?? null;
}

/**
 * Close-Lead zu E-Mail/Telefon finden (fehlertolerant, null wenn nichts eindeutig passt):
 * 1. Spiegel-Tabelle close_leads (Kontakt-E-Mails aus dem Close-Sync)
 * 2. Close-Suche, Treffer wird an den Kontaktdaten gegengeprüft
 */
export async function findeCloseLead(
  svc: SupabaseClient,
  { email, telefon }: { email?: string | null; telefon?: string | null },
): Promise<string | null> {
  const mail = email?.trim().toLowerCase() || null;
  if (mail) {
    try {
      const { data } = await svc
        .from("close_leads")
        .select("close_id")
        .contains("custom_fields", { _contact_emails: [mail] })
        .limit(1);
      const id = (data as Array<{ close_id: string }> | null)?.[0]?.close_id;
      if (id) return id;
    } catch {
      // weiter mit der Close-Suche
    }
  }

  const passt = (lead: CloseLeadDaten) =>
    (lead.contacts ?? []).some(
      (k) =>
        (mail && (k.emails ?? []).some((e) => e.email?.toLowerCase() === mail)) ||
        (telefon && (k.phones ?? []).some((p) => normalisiereTelefon(p.phone) === telefon)),
    );

  const suchen: string[] = [];
  if (mail) suchen.push(`email:"${mail.replace(/"/g, "")}"`);
  if (telefon) suchen.push(`phone:"${telefon}"`);
  for (const query of suchen) {
    try {
      const { data } = await closeApi<{ data: CloseLeadDaten[] }>("/lead/", {
        params: { query, _fields: "id,contacts", _limit: "5" },
      });
      const treffer = data.filter(passt);
      if (treffer.length >= 1) return treffer[0].id;
    } catch (err) {
      console.error("[whatsapp] Close-Lead-Suche fehlgeschlagen:", err);
    }
  }
  return null;
}

/** Wert eines Close-Feldes: "custom.cf_…", "cf_…" oder Feldname (aus lead.custom). */
export function feldWert(obj: Record<string, unknown> | null | undefined, feld: string): unknown {
  if (!obj) return undefined;
  const kandidaten = [feld, feld.startsWith("custom.") ? feld : `custom.${feld}`];
  for (const k of kandidaten) if (obj[k] !== undefined) return obj[k];
  const custom = obj.custom as Record<string, unknown> | undefined;
  if (custom && custom[feld] !== undefined) return custom[feld];
  return undefined;
}

/** „Ja“-Prüfung für das Einwilligungsfeld (auch Mehrfachauswahl/Boolean). */
export function istJa(wert: unknown): boolean {
  if (wert === true) return true;
  if (Array.isArray(wert)) return wert.some(istJa);
  return typeof wert === "string" && wert.trim().toLowerCase() === "ja";
}
