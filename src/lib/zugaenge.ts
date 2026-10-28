import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Kontext } from "@/lib/kontext";
import type { UserRole } from "@/lib/types/database";
import { darfZugangVerwalten, istKundenRolle, zugangUmbauGesperrt } from "@/lib/zugriff";

// Zugänge anlegen: erzeugt einen Link zum Kopieren. Es wird KEINE E-Mail verschickt
// (generateLink sendet nichts; inviteUserByEmail/resetPasswordForEmail bewusst nicht benutzt).

export interface ZugangErgebnis {
  fehler: string | null;
  link: string | null;
  email: string | null;
  neu: boolean;
}

export const LEERES_ERGEBNIS: ZugangErgebnis = { fehler: null, link: null, email: null, neu: false };

const fehler = (text: string): ZugangErgebnis => ({ ...LEERES_ERGEBNIS, fehler: text });

async function basisUrl(): Promise<string> {
  const fest = process.env.NEXT_PUBLIC_SITE_URL;
  if (fest) return fest.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Spalten aus Migration 00013 weglassen, falls sie live noch fehlen. */
export function fehlendeSpalte(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "PGRST204" || err.code === "42703" || /column/i.test(err.message ?? "");
}

export async function zugangsLinkErzeugen(
  handelnd: Kontext,
  eingabe: { email: string; fullName: string; rolle: UserRole; companyId: string | null }
): Promise<ZugangErgebnis> {
  const email = eingabe.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fehler("Bitte eine gültige E-Mail eingeben.");
  if (!eingabe.fullName.trim()) return fehler("Bitte einen Namen eingeben.");
  if (!darfZugangVerwalten(handelnd.rolle, eingabe.rolle)) return fehler("Diese Rolle darfst du nicht vergeben.");
  if (istKundenRolle(eingabe.rolle) && !eingabe.companyId) return fehler("Kundenzugang braucht eine Firma.");

  const db = createAdminClient();
  let typ: "invite" | "recovery" = "invite";
  let res = await db.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: eingabe.fullName.trim() } },
  });
  if (res.error && (res.error.code === "email_exists" || res.error.status === 422 || /already/i.test(res.error.message))) {
    typ = "recovery";
    res = await db.auth.admin.generateLink({ type: "recovery", email });
  }
  if (res.error || !res.data.user || !res.data.properties?.hashed_token) {
    return fehler(`Link konnte nicht erzeugt werden: ${res.error?.message ?? "unbekannt"}`);
  }

  const userId = res.data.user.id;
  const { data: bisher } = await db.from("profiles").select("role, company_id").eq("id", userId).maybeSingle();
  const alt = bisher as { role: UserRole; company_id: string | null } | null;
  if (alt && !darfZugangVerwalten(handelnd.rolle, alt.role)) {
    return fehler("Diese E-Mail gehört zu einem Team-Zugang. Das kann nur ein Admin ändern.");
  }
  const gesperrt = zugangUmbauGesperrt(alt && { rolle: alt.role, companyId: alt.company_id }, { rolle: eingabe.rolle, companyId: eingabe.companyId });
  if (gesperrt === "team_zu_kunde") {
    return fehler("Diese E-Mail gehört zu einem Team-Zugang und kann kein Kundenzugang werden.");
  }
  if (gesperrt === "andere_firma") {
    const { data: firma } = await db.from("companies").select("name").eq("id", alt!.company_id!).maybeSingle();
    return fehler(`Diese E-Mail gehört bereits zu Firma ${(firma as { name: string } | null)?.name ?? "(unbekannt)"}.`);
  }
  if (userId === handelnd.profile.id && eingabe.rolle !== handelnd.rolle) {
    return fehler("Deine eigene Rolle kannst du hier nicht ändern.");
  }

  const zeile = {
    id: userId,
    full_name: eingabe.fullName.trim(),
    role: eingabe.rolle,
    company_id: istKundenRolle(eingabe.rolle) ? eingabe.companyId : null,
    active: true,
    email,
  };
  let { error } = await db.from("profiles").upsert(zeile, { onConflict: "id" });
  if (fehlendeSpalte(error)) {
    const { email: _ohne, ...ohneEmail } = zeile;
    void _ohne;
    ({ error } = await db.from("profiles").upsert(ohneEmail, { onConflict: "id" }));
  }
  if (error) return fehler(`Profil konnte nicht gespeichert werden: ${error.message}`);

  await db.auth.admin.updateUserById(userId, { ban_duration: "none" });

  const link = `${await basisUrl()}/passwort-setzen?token_hash=${encodeURIComponent(res.data.properties.hashed_token)}&type=${typ}`;
  return { fehler: null, link, email, neu: typ === "invite" };
}

export async function zugangAktivSetzen(handelnd: Kontext, userId: string, aktiv: boolean): Promise<string | null> {
  if (userId === handelnd.profile.id) return "Du kannst dich nicht selbst sperren.";
  const db = createAdminClient();
  const { data } = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!data) return "Zugang nicht gefunden.";
  if (!darfZugangVerwalten(handelnd.rolle, (data as { role: UserRole }).role)) return "Das darfst du nicht.";

  const { error } = await db.from("profiles").update({ active: aktiv }).eq("id", userId);
  if (error) return error.message;
  // Sperre auch in Supabase Auth, damit kein neuer Login/Refresh möglich ist
  await db.auth.admin.updateUserById(userId, { ban_duration: aktiv ? "none" : "876000h" });
  return null;
}
