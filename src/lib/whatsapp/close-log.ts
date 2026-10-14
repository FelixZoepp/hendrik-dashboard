import type { SupabaseClient } from "@supabase/supabase-js";
import { ABGESCHLOSSEN, LEAD, OPP_TERMIN_AM_FELD, pipelineFuerBuchung, pipelineStand, type PipelineOpp } from "@/lib/close-pipeline";
import { closeApi, closeUserName, type CloseUser } from "@/lib/integrations/close";
import { CLOSE_STATUS_WERTE, type CloseStatusWert } from "./einrichtung";
import { ladeEinstellungen } from "./einstellungen";
import { leadName, meldeSlack, terminZeilen } from "./slack";
import type { Termin } from "./termine";
import { AUFGABEN } from "./vorlagen";
import { berlinDatum, firmenDomain, normalisiereTelefon, type TerminArt } from "./logik";

const CLOSE_TIMEOUT_MS = 10_000;

/** Close-Aufruf des Bots mit festem Zeitlimit (der Bot darf nie hängen bleiben). */
function closeBot<T>(path: string, opts: Omit<NonNullable<Parameters<typeof closeApi>[1]>, "signal"> = {}): Promise<T> {
  return closeApi<T>(path, { ...opts, signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS) });
}

/**
 * Close-Anbindung des WhatsApp-Terminbots: Notizen und Aufgaben am Lead,
 * Lead-Suche per E-Mail/Telefon/Firmen-Domain, Lead/Opportunity zu Calendly-Buchungen,
 * Statusfeld „WhatsApp-Termin“. Alles läuft immer (auch wenn der Bot aus ist) — es geht
 * nur an das eigene Team bzw. ins CRM, nie an den Lead.
 */

/** Notiz am Close-Lead (best effort — Fehler werden geworfen, Aufrufer fängt). */
export async function notizAnLead(leadId: string | null | undefined, text: string): Promise<void> {
  if (!leadId) return;
  await closeBot("/activity/note/", { method: "POST", body: { lead_id: leadId, note: text } });
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
  const { data: offene } = await closeBot<{ data: Array<{ text: string; date: string | null }> }>("/task/", {
    params: { lead_id: leadId, is_complete: "false", _fields: "text,date" },
  });
  if (offene.some((t) => t.text === text && t.date?.slice(0, 10) === datum.slice(0, 10))) return null;
  const aufgabe = await closeBot<{ id: string }>("/task/", {
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
  return closeBot<CloseLeadDaten>(`/lead/${leadId}/`);
}

/** Name einer Close-Benutzer-ID (für den Gastgeber). */
export async function closeBenutzerName(svc: SupabaseClient, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await svc.from("close_users").select("name").eq("close_id", userId).maybeSingle();
  if ((data as { name?: string } | null)?.name) return (data as { name: string }).name;
  try {
    return closeUserName(await closeBot<CloseUser>(`/user/${userId}/`));
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
 * 2. Close-Suche per E-Mail, dann per jeder Telefonnummer — Treffer wird an den Kontaktdaten gegengeprüft
 * 3. Firmen-Domain der E-Mail (keine Freemail): nur wenn genau EIN Lead einen Kontakt mit
 *    E-Mail „…@domain“ hat (Close-Suche `email:"domain"` findet auch Teiltreffer)
 */
export async function findeCloseLead(
  svc: SupabaseClient,
  { email, telefon, telefone }: { email?: string | null; telefon?: string | null; telefone?: string[] },
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

  const nummern = [...new Set([telefon, ...(telefone ?? [])].filter((t): t is string => !!t))];
  const suche = async (query: string, limit = "5") => {
    try {
      const { data } = await closeBot<{ data: CloseLeadDaten[] }>("/lead/", {
        params: { query, _fields: "id,contacts", _limit: limit },
      });
      return data;
    } catch (err) {
      console.error("[whatsapp] Close-Lead-Suche fehlgeschlagen:", err);
      return [];
    }
  };
  const kontaktPasst = (lead: CloseLeadDaten, pruefe: (k: LeadKontakt) => boolean) => (lead.contacts ?? []).some(pruefe);

  if (mail) {
    const treffer = (await suche(`email:"${mail.replace(/"/g, "")}"`)).filter((l) =>
      kontaktPasst(l, (k) => (k.emails ?? []).some((e) => e.email?.toLowerCase() === mail)),
    );
    if (treffer.length >= 1) return treffer[0].id;
  }
  for (const nummer of nummern) {
    const treffer = (await suche(`phone:"${nummer}"`)).filter((l) =>
      kontaktPasst(l, (k) => (k.phones ?? []).some((p) => normalisiereTelefon(p.phone) === nummer)),
    );
    if (treffer.length >= 1) return treffer[0].id;
  }

  const domain = firmenDomain(mail);
  if (domain) {
    const endung = `@${domain}`;
    const treffer = (await suche(`email:"${domain}"`, "10")).filter((l) =>
      kontaktPasst(l, (k) => (k.emails ?? []).some((e) => e.email?.trim().toLowerCase().endsWith(endung))),
    );
    // Mehrere Leads mit derselben Domain → nicht raten
    if (treffer.length === 1) return treffer[0].id;
  }
  return null;
}

/**
 * Neuen Close-Lead aus einer Calendly-Buchung anlegen (es gab keinen passenden).
 * Name = Firma, sonst Personenname; Kontakt mit Name, E-Mail, Telefon (mobil);
 * Lead-Status Setting (Erstgespräch) bzw. Closing (Strategiegespräch). Fehler werden geworfen.
 */
export async function legeCloseLeadAn(d: {
  art: TerminArt;
  name: string | null;
  firma: string | null;
  email: string | null;
  telefon: string | null;
}): Promise<string> {
  const leadName = d.firma || d.name || d.email || d.telefon || "Calendly-Buchung";
  const lead = await closeBot<{ id: string }>("/lead/", {
    method: "POST",
    body: {
      name: leadName,
      status_id: d.art === "strategie" ? LEAD.closing : LEAD.setting,
      contacts: [
        {
          ...(d.name ? { name: d.name } : {}),
          ...(d.email ? { emails: [{ email: d.email, type: "office" }] } : {}),
          ...(d.telefon ? { phones: [{ phone: d.telefon, type: "mobile" }] } : {}),
        },
      ],
    },
  });
  await notizSicher(lead.id, "Lead automatisch aus Calendly-Buchung angelegt");
  return lead.id;
}

/**
 * Calendly-Buchung in die Pipeline „Setter-Closer Hoffmann Solutions“ übernehmen:
 * aktive Opportunity nur vorwärts bewegen bzw. neue anlegen (Termin am = Start, Zuständig =
 * Gastgeber), Lead-Status Setting/Closing (nicht bei Kunde). Rückgabe: Opportunity-ID.
 * Fehler werden geworfen (Aufrufer: best effort).
 */
export async function pipelineNachBuchung(d: {
  leadId: string;
  art: TerminArt;
  startAt: string;
  userId: string | null;
}): Promise<{ oppId: string; aktion: string }> {
  const lead = await closeBot<{ status_id: string; opportunities: PipelineOpp[] }>(`/lead/${d.leadId}/`, {
    params: { _fields: "status_id,opportunities" },
  });
  const schritt = pipelineFuerBuchung({ status_id: lead.status_id, opportunities: lead.opportunities ?? [] }, d.art);
  // Gleiches Format wie die Close-Automatik (Kalenderwert aus dem Protokoll): ISO-Zeitpunkt
  const terminAm = new Date(d.startAt).toISOString();
  const update: Record<string, unknown> = {
    ...(schritt.opp === "schon_weiter" ? {} : { status_id: schritt.status }),
    [OPP_TERMIN_AM_FELD]: terminAm,
    ...(d.userId ? { user_id: d.userId } : {}),
  };

  let oppId: string;
  if (schritt.opp === "anlegen") {
    oppId = (await closeBot<{ id: string }>("/opportunity/", { method: "POST", body: { lead_id: d.leadId, ...update } })).id;
  } else if (schritt.opp === "verschieben") {
    await closeBot(`/opportunity/${schritt.id}/`, { method: "PUT", body: update });
    oppId = schritt.id;
  } else {
    // Opportunity ist schon weiter (z. B. Closing) → Status und Termin bleiben
    oppId = schritt.id;
  }
  if (schritt.leadStatus) {
    await closeBot(`/lead/${d.leadId}/`, { method: "PUT", body: { status_id: schritt.leadStatus } });
  }
  return { oppId, aktion: schritt.opp };
}

/**
 * Vom Bot angelegten Lead in den echten Lead zusammenführen (Close: POST /lead/merge/).
 * Nie blockierend: Fehler → Log + Notiz am echten Lead. Danach Hinweis, falls der Lead
 * jetzt zwei laufende Opportunities in der Pipeline hat (der Bot löscht nichts).
 */
export async function fuehreBotLeadZusammen(
  svc: SupabaseClient,
  z: { quelle: string; ziel: string; terminId: string },
): Promise<boolean> {
  try {
    await closeBot("/lead/merge/", { method: "POST", body: { source: z.quelle, destination: z.ziel } });
  } catch (err) {
    const fehler = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp] Lead-Zusammenführung fehlgeschlagen:", err);
    await svc.from("webhook_errors").insert({
      endpoint: "whatsapp",
      payload: { aktion: "lead_merge", source: z.quelle, destination: z.ziel, termin_id: z.terminId },
      error: fehler,
    });
    await notizSicher(
      z.ziel,
      `Automatisch aus Calendly angelegter Lead ${z.quelle} konnte nicht zusammengeführt werden — bitte manuell zusammenführen.`,
    );
    return false;
  }
  await notizSicher(z.ziel, `Automatisch aus Calendly angelegten Lead ${z.quelle} mit diesem Lead zusammengeführt.`);
  try {
    const lead = await closeBot<{ opportunities: PipelineOpp[] }>(`/lead/${z.ziel}/`, { params: { _fields: "opportunities" } });
    const laufend = pipelineStand(lead.opportunities ?? []).pipelineOpps.filter((o) => !ABGESCHLOSSEN.has(o.status_id));
    if (laufend.length > 1) await notizSicher(z.ziel, "Achtung: Lead hat jetzt mehrere laufende Opportunities in der Pipeline — bitte prüfen.");
  } catch (err) {
    console.error("[whatsapp] Opportunities nach Zusammenführung nicht geprüft:", err);
  }
  return true;
}

/** Statusfeld „WhatsApp-Termin“ am Lead setzen (best effort, nur wenn das Feld eingerichtet ist). */
export async function setzeCloseStatus(
  svc: SupabaseClient,
  leadId: string | null | undefined,
  wert: CloseStatusWert,
): Promise<void> {
  if (!leadId) return;
  try {
    const feld = (await ladeEinstellungen(svc)).close_status_feld;
    if (!feld) return;
    const schluessel = feld.startsWith("custom.") ? feld : `custom.${feld}`;
    await closeBot(`/lead/${leadId}/`, { method: "PUT", body: { [schluessel]: wert } });
  } catch (err) {
    console.error("[whatsapp] Close-Statusfeld nicht gesetzt:", err);
  }
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

/**
 * Meta meldet per Status-Webhook „failed“: Notiz am Lead („WhatsApp nicht zugestellt: …“) und
 * Statusfeld „Nicht zugestellt“ — Letzteres nur für Vorlagen und nicht bei bestätigten Terminen.
 * Best effort, wirft nie.
 */
export async function meldeNichtZugestellt(
  svc: SupabaseClient,
  n: {
    closeLeadId: string | null;
    terminId: string | null;
    typ: string | null;
    vorlage: string | null;
    fehler: string;
    telefon?: string | null;
  },
): Promise<void> {
  try {
    await notizSicher(n.closeLeadId, `WhatsApp nicht zugestellt: ${n.vorlage ?? n.typ ?? "Nachricht"} – ${n.fehler}`);
    if (n.typ !== "template") return;
    let termin: Termin | null = null;
    if (n.terminId) {
      const { data } = await svc.from("wa_termine").select("*").eq("id", n.terminId).maybeSingle();
      termin = (data as Termin | null) ?? null;
      if (termin?.bestaetigt_am || termin?.status === "abgesagt") return;
    }
    const aufgabe = n.closeLeadId
      ? await aufgabeAnLead(n.closeLeadId, AUFGABEN.nichtZugestellt, {
          datum: berlinDatum(new Date()),
          zustaendig: termin?.close_user_id ?? null,
        }).catch(() => null)
      : null;
    await meldeSlack({
      emoji: "❌",
      titel: `WhatsApp an ${leadName(termin, n.telefon)} nicht zugestellt`,
      zeilen: [
        ...(termin ? terminZeilen(termin) : []),
        `Grund: ${n.fehler}`,
        aufgabe ? "📝 Aufgabe „Nummer prüfen und anrufen“ in Close angelegt" : null,
      ],
      telefon: n.telefon ?? termin?.telefon,
      closeLeadId: n.closeLeadId,
    });
    if (n.closeLeadId) await setzeCloseStatus(svc, n.closeLeadId, CLOSE_STATUS_WERTE.nichtZugestellt);
  } catch (err) {
    console.error("[whatsapp] Zustellfehler nicht an Close gemeldet:", err);
  }
}
