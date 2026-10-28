"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getKontext, requireTeam } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ANSICHT_COOKIE, ANSICHT_MAX_ALTER_SEKUNDEN, ANSICHT_ROLLEN, ROLLEN_ANSICHT_COOKIE, istUuid, startseiteFuer, type Rolle } from "@/lib/zugriff";

/** „Als Kunde ansehen“: Cookie setzen und ins Kundenportal wechseln. */
export async function ansichtStarten(formData: FormData) {
  await requireTeam(["admin", "sales", "fulfillment"]);
  const companyId = String(formData.get("company_id") ?? "");
  if (!istUuid(companyId)) redirect("/kunden");

  const { data } = await createAdminClient().from("companies").select("id").eq("id", companyId).maybeSingle();
  if (!data) redirect("/kunden");

  (await cookies()).set(ANSICHT_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ANSICHT_MAX_ALTER_SEKUNDEN,
  });
  redirect("/dashboard");
}

export async function ansichtBeenden() {
  (await cookies()).delete(ANSICHT_COOKIE);
  redirect("/kunden");
}

/**
 * Ansichts-Umschalter (nur echte Admins): admin | sales | fulfillment.
 * Kunde läuft über ansichtStarten (Firma wählen).
 */
export async function rolleAnsehen(formData: FormData) {
  const ctx = await getKontext();
  if (!ctx || ctx.echteRolle !== "admin") redirect("/login");
  const rolle = String(formData.get("rolle") ?? "") as Rolle;
  const keks = await cookies();
  keks.delete(ANSICHT_COOKIE);
  if (ANSICHT_ROLLEN.includes(rolle)) {
    keks.set(ROLLEN_ANSICHT_COOKIE, rolle, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ANSICHT_MAX_ALTER_SEKUNDEN,
    });
    redirect(startseiteFuer(rolle));
  }
  keks.delete(ROLLEN_ANSICHT_COOKIE);
  redirect("/sales");
}

/** Testkunde direkt ansehen (nur echte Admins). */
export async function kundeAnsehen(formData: FormData) {
  const ctx = await getKontext();
  if (!ctx || ctx.echteRolle !== "admin") redirect("/login");
  (await cookies()).delete(ROLLEN_ANSICHT_COOKIE);
  await ansichtStarten(formData);
}

export async function abmelden() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const keks = await cookies();
  keks.delete(ANSICHT_COOKIE);
  keks.delete(ROLLEN_ANSICHT_COOKIE);
  redirect("/login");
}
