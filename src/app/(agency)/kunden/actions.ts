"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTeam } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { fehlendeSpalte, zugangAktivSetzen, zugangsLinkErzeugen, type ZugangErgebnis } from "@/lib/zugaenge";
import { istKundenRolle, istUuid } from "@/lib/zugriff";
import type { CompanyStatus } from "@/lib/types/database";

export interface FirmaStatus {
  fehler: string | null;
  gespeichert: boolean;
}

const STATUS: CompanyStatus[] = ["onboarding", "aktiv", "pausiert", "gekuendigt"];

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};

/** Anlegen (ohne id) oder Bearbeiten (mit id) eines Handwerksbetriebs. */
export async function firmaSpeichern(_vorher: FirmaStatus, formData: FormData): Promise<FirmaStatus> {
  await requireTeam();
  const id = text(formData, "id");
  const name = text(formData, "name");
  if (!name) return { fehler: "Bitte einen Firmennamen eingeben.", gespeichert: false };
  const status = String(formData.get("status") ?? "onboarding") as CompanyStatus;
  if (!STATUS.includes(status)) return { fehler: "Ungültiger Status.", gespeichert: false };

  const basis = {
    name,
    ansprechpartner: text(formData, "ansprechpartner"),
    telefon: text(formData, "telefon"),
    email: text(formData, "email"),
    branche: text(formData, "branche"),
    status,
  };
  const neu = { ort: text(formData, "ort"), region: text(formData, "region") };

  const db = createAdminClient();
  const schreibe = (werte: Record<string, unknown>) =>
    id
      ? db.from("companies").update(werte).eq("id", id).select("id").single()
      : db.from("companies").insert(werte).select("id").single();

  let res = await schreibe({ ...basis, ...neu });
  if (fehlendeSpalte(res.error)) res = await schreibe(basis);
  if (res.error || !res.data) return { fehler: `Speichern fehlgeschlagen: ${res.error?.message ?? "unbekannt"}`, gespeichert: false };

  revalidatePath("/kunden");
  if (!id) redirect(`/kunden/${(res.data as { id: string }).id}`);
  revalidatePath(`/kunden/${id}`);
  return { fehler: null, gespeichert: true };
}

export async function kundenZugangAnlegen(_vorher: ZugangErgebnis, formData: FormData): Promise<ZugangErgebnis> {
  const ctx = await requireTeam();
  const rolle = String(formData.get("rolle") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  if (!istKundenRolle(rolle) || !istUuid(companyId)) {
    return { fehler: "Ungültige Angaben.", link: null, email: null, neu: false };
  }
  const { data: firma } = await createAdminClient().from("companies").select("id").eq("id", companyId).maybeSingle();
  if (!firma) return { fehler: "Firma nicht gefunden.", link: null, email: null, neu: false };

  const ergebnis = await zugangsLinkErzeugen(ctx, {
    email: String(formData.get("email") ?? ""),
    fullName: String(formData.get("full_name") ?? ""),
    rolle,
    companyId,
  });
  revalidatePath(`/kunden/${companyId}`);
  return ergebnis;
}

export async function kundenZugangAktiv(formData: FormData) {
  const ctx = await requireTeam();
  const companyId = String(formData.get("company_id") ?? "");
  const fehler = await zugangAktivSetzen(ctx, String(formData.get("user_id") ?? ""), formData.get("aktiv") === "1");
  const ziel = istUuid(companyId) ? `/kunden/${companyId}` : "/kunden";
  revalidatePath(ziel);
  if (fehler) redirect(`${ziel}?fehler=${encodeURIComponent(fehler)}`);
}
