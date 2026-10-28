"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTeam } from "@/lib/kontext";
import { zugangAktivSetzen, zugangsLinkErzeugen, type ZugangErgebnis } from "@/lib/zugaenge";
import { istTeamRolle } from "@/lib/zugriff";

export async function teamZugangAnlegen(_vorher: ZugangErgebnis, formData: FormData): Promise<ZugangErgebnis> {
  const ctx = await requireTeam(["admin"]);
  const rolle = String(formData.get("rolle") ?? "");
  if (!istTeamRolle(rolle)) return { fehler: "Ungültige Rolle.", link: null, email: null, neu: false };
  const ergebnis = await zugangsLinkErzeugen(ctx, {
    email: String(formData.get("email") ?? ""),
    fullName: String(formData.get("full_name") ?? ""),
    rolle,
    companyId: null,
  });
  revalidatePath("/team");
  return ergebnis;
}

export async function teamZugangAktiv(formData: FormData) {
  const ctx = await requireTeam(["admin"]);
  const fehler = await zugangAktivSetzen(ctx, String(formData.get("user_id") ?? ""), formData.get("aktiv") === "1");
  revalidatePath("/team");
  if (fehler) redirect(`/team?fehler=${encodeURIComponent(fehler)}`);
}
