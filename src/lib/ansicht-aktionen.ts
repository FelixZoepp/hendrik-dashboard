"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireTeam } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ANSICHT_COOKIE, ANSICHT_MAX_ALTER_SEKUNDEN, istUuid } from "@/lib/zugriff";

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

export async function abmelden() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ANSICHT_COOKIE);
  redirect("/login");
}
