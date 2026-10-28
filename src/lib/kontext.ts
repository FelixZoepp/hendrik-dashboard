import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Company, Profile, UserRole } from "@/lib/types/database";
import { ANSICHT_COOKIE, ROLLEN_ANSICHT_COOKIE, istTeamRolle, istUuid, startseiteFuer, wirksameFirma, wirksameRolle } from "@/lib/zugriff";

/**
 * Wer ist angemeldet und für welche Firma (Handwerksbetrieb) gilt die Anfrage?
 *
 * DATENZUGRIFF IN KUNDENSEITEN (src/app/(client)/**) — eine Regel:
 *   const ctx = await requireKunde();
 *   const db = createAdminClient();
 *   db.from("leads").select("*").eq("company_id", ctx.companyId)   // IMMER filtern
 *
 * - Lesen UND Schreiben laufen über createAdminClient() (Service-Rolle, umgeht RLS).
 *   Jede Abfrage auf firmenbezogene Tabellen MUSS .eq("company_id", ctx.companyId) tragen,
 *   bei Einzelzugriff per id zusätzlich (z. B. .eq("id", id).eq("company_id", ctx.companyId)).
 *   Kind-Tabellen ohne company_id (lead_activities …) erst nach Prüfung des Elternteils lesen.
 * - Grund: Beim „Als Kunde ansehen“ ist auth.uid() ein Team-Mitglied, RLS würde alle Firmen
 *   (is_staff) zeigen. ctx.companyId ist die einzige Wahrheit, für Kunden und Impersonation gleich.
 * - Server Actions rufen requireKunde() selbst auf (Proxy/Layout schützen Actions nicht sicher).
 * - Nutzerbezogenes (lesson_progress …) nutzt ctx.profile.id. Bei Impersonation
 *   (ctx.impersoniert) nichts im Namen des Kunden schreiben, was ihn verändert, ohne Absicht.
 * - Der RLS-Client (lib/supabase/server) bleibt für Auth-Aufrufe (getUser, Passwort).
 */
export interface KontextFirma {
  id: string;
  name: string;
  status: Company["status"];
  branche: string | null;
  ansprechpartner: string | null;
  telefon: string | null;
  email: string | null;
  ort: string | null;
  region: string | null;
}

export interface Kontext {
  profile: Profile;
  /** Wirksame Rolle (beim „Als Mitarbeiter ansehen“ eines Admins: sales/fulfillment). */
  rolle: UserRole;
  /** Rolle laut Profil – nur für den Ansichts-Umschalter, nie für Rechte. */
  echteRolle: UserRole;
  /** Admin sieht die Cloud gerade als Sales/Fulfillment. */
  rollenAnsicht: boolean;
  istTeam: boolean;
  /** Kunde: eigene company_id. Team: Firma aus „Als Kunde ansehen“, sonst null. */
  companyId: string | null;
  company: KontextFirma | null;
  impersoniert: boolean;
  email: string | null;
}

export type KundenKontext = Kontext & { companyId: string; company: KontextFirma };

function alsFirma(c: Partial<Company> & { id: string; name: string }): KontextFirma {
  return {
    id: c.id,
    name: c.name,
    status: c.status ?? "onboarding",
    branche: c.branche ?? null,
    ansprechpartner: c.ansprechpartner ?? null,
    telefon: c.telefon ?? null,
    email: c.email ?? null,
    ort: c.ort ?? null,
    region: c.region ?? null,
  };
}

/** Kontext der aktuellen Anfrage (pro Request gecacht). null = nicht angemeldet / kein aktives Profil. */
export const getKontext = cache(async (): Promise<Kontext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const db = createAdminClient();
  const { data: profil } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profil || !(profil as Profile).active) return null;
  const profile = profil as Profile;

  const istTeam = istTeamRolle(profile.role);
  const keks = await cookies();
  const rolle = wirksameRolle(profile.role, keks.get(ROLLEN_ANSICHT_COOKIE)?.value) as UserRole;
  const cookieWert = istTeam ? keks.get(ANSICHT_COOKIE)?.value ?? null : null;
  const gesuchteId = istTeam ? (istUuid(cookieWert) ? cookieWert : null) : profile.company_id;

  let firma: KontextFirma | null = null;
  if (gesuchteId) {
    const { data } = await db.from("companies").select("*").eq("id", gesuchteId).maybeSingle();
    if (data) firma = alsFirma(data as Company);
  }

  const { companyId, impersoniert } = wirksameFirma({
    rolle: profile.role,
    eigeneCompanyId: profile.company_id,
    cookieWert,
    firmaExistiert: !!firma,
  });

  return {
    profile,
    rolle,
    echteRolle: profile.role,
    rollenAnsicht: rolle !== profile.role,
    istTeam,
    companyId: companyId && firma ? companyId : null,
    company: companyId ? firma : null,
    impersoniert,
    email: user.email ?? null,
  };
});

/** Nur Team (admin/sales/fulfillment), optional auf bestimmte Rollen eingeschränkt. */
export async function requireTeam(rollen?: UserRole[]): Promise<Kontext> {
  const ctx = await getKontext();
  if (!ctx) redirect("/login");
  if (!ctx.istTeam) redirect(startseiteFuer(ctx.rolle));
  if (rollen && !rollen.includes(ctx.rolle)) redirect(startseiteFuer(ctx.rolle));
  return ctx;
}

/**
 * Kundenbereich: liefert garantiert companyId + company.
 * Team ohne „Als Kunde ansehen“ → /kunden. Kunde ohne Firma → /kein-zugang.
 */
export async function requireKunde(): Promise<KundenKontext> {
  const ctx = await getKontext();
  if (!ctx) redirect("/login");
  if (!ctx.companyId || !ctx.company) {
    redirect(ctx.istTeam ? "/kunden?hinweis=ansicht" : "/kein-zugang");
  }
  return ctx as KundenKontext;
}
