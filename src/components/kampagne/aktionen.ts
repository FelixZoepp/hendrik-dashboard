"use server";

import { revalidatePath } from "next/cache";
import { requireTeam } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { istUuid } from "@/lib/zugriff";
import {
  istMonat,
  normalisiereKampagnenId,
  normalisiereWerbekonto,
  pruefeZuordnung,
  type Plattform,
  type Zuordnung,
} from "@/lib/kampagne/logik";
import { syncKampagnenMitLog } from "@/lib/kampagne/sync";

export interface AktionsStatus {
  fehler: string | null;
  meldung: string | null;
}

const OK = (meldung: string): AktionsStatus => ({ fehler: null, meldung });
const FEHLER = (fehler: string): AktionsStatus => ({ fehler, meldung: null });

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function firmaPruefen(fd: FormData): Promise<string | null> {
  await requireTeam();
  const id = text(fd, "company_id");
  if (!istUuid(id)) return null;
  const { data } = await createAdminClient().from("companies").select("id").eq("id", id).maybeSingle();
  return data ? id : null;
}

const neuLaden = (companyId: string) => revalidatePath(`/kunden/${companyId}`);

export async function kampagneZuordnen(_v: AktionsStatus, fd: FormData): Promise<AktionsStatus> {
  const companyId = await firmaPruefen(fd);
  if (!companyId) return FEHLER("Firma nicht gefunden.");
  const plattform = (text(fd, "plattform") || "meta") as Plattform;
  const kampagneId = normalisiereKampagnenId(text(fd, "kampagne_id"));
  if (!kampagneId) return FEHLER("Bitte eine gültige Kampagnen-ID (nur Ziffern) eingeben.");
  // Name: aus Auswahl „id|name“ oder Freitext
  const name = text(fd, "kampagne_name") || null;

  const db = createAdminClient();
  const { data: bestehende, error: lesefehler } = await db
    .from("kampagnen_zuordnung")
    .select("company_id, plattform, kampagne_id, aktiv")
    .eq("plattform", plattform)
    .eq("kampagne_id", kampagneId);
  if (lesefehler) return FEHLER(`Lesen fehlgeschlagen: ${lesefehler.message}`);

  const pruefung = pruefeZuordnung({ plattform, kampagne_id: kampagneId, company_id: companyId }, (bestehende ?? []) as Zuordnung[]);
  if (!pruefung.ok) {
    if (pruefung.grund === "andere_firma") {
      const { data: andere } = await db.from("companies").select("name").eq("id", pruefung.companyId!).maybeSingle();
      return FEHLER(`Diese Kampagne gehört schon zu „${andere?.name ?? "einer anderen Firma"}“. Dort zuerst entfernen.`);
    }
    return FEHLER("Ungültige Kampagne.");
  }
  if (pruefung.vorhanden) return OK("Kampagne war schon zugeordnet.");

  const { error } = await db.from("kampagnen_zuordnung").insert({
    company_id: companyId,
    plattform,
    kampagne_id: kampagneId,
    kampagne_name: name,
    aktiv: true,
  });
  if (error) return FEHLER(`Speichern fehlgeschlagen: ${error.message}`);
  neuLaden(companyId);
  return OK("Kampagne zugeordnet. Die Kosten kommen mit dem nächsten Abgleich.");
}

export async function kampagneAktivSetzen(fd: FormData): Promise<void> {
  const companyId = await firmaPruefen(fd);
  if (!companyId) return;
  await createAdminClient()
    .from("kampagnen_zuordnung")
    .update({ aktiv: text(fd, "aktiv") === "1" })
    .eq("company_id", companyId)
    .eq("id", text(fd, "id"));
  neuLaden(companyId);
}

/** Zuordnung löschen inkl. der dieser Firma zugerechneten Tageskosten der Kampagne. */
export async function kampagneEntfernen(fd: FormData): Promise<void> {
  const companyId = await firmaPruefen(fd);
  if (!companyId) return;
  const db = createAdminClient();
  const { data } = await db
    .from("kampagnen_zuordnung")
    .delete()
    .eq("company_id", companyId)
    .eq("id", text(fd, "id"))
    .select("plattform, kampagne_id");
  for (const z of data ?? []) {
    await db
      .from("kampagnen_kosten_tag")
      .delete()
      .eq("company_id", companyId)
      .eq("plattform", z.plattform)
      .eq("kampagne_id", z.kampagne_id);
  }
  neuLaden(companyId);
}

export async function werbekontoSpeichern(_v: AktionsStatus, fd: FormData): Promise<AktionsStatus> {
  const companyId = await firmaPruefen(fd);
  if (!companyId) return FEHLER("Firma nicht gefunden.");
  const konto = normalisiereWerbekonto(text(fd, "werbekonto_id"));
  if (!konto) return FEHLER("Bitte eine Werbekonto-ID wie act_123456789 eingeben.");
  if (konto === normalisiereWerbekonto(process.env.META_AD_ACCOUNT_ID)) {
    return FEHLER("Das ist das zentrale Werbekonto – dort bitte einzelne Kampagnen zuordnen.");
  }
  const db = createAdminClient();
  const { data: vorhanden } = await db
    .from("kampagnen_werbekonto")
    .select("company_id")
    .eq("plattform", "meta")
    .eq("werbekonto_id", konto)
    .maybeSingle();
  if (vorhanden && vorhanden.company_id !== companyId) return FEHLER("Dieses Werbekonto gehört schon zu einer anderen Firma.");
  if (vorhanden) return OK("Werbekonto war schon hinterlegt.");
  const { error } = await db
    .from("kampagnen_werbekonto")
    .insert({ company_id: companyId, plattform: "meta", werbekonto_id: konto, aktiv: true });
  if (error) return FEHLER(`Speichern fehlgeschlagen: ${error.message}`);
  neuLaden(companyId);
  return OK("Werbekonto hinterlegt. Alle Kampagnen darin zählen ab dem nächsten Abgleich für diese Firma.");
}

export async function werbekontoEntfernen(fd: FormData): Promise<void> {
  const companyId = await firmaPruefen(fd);
  if (!companyId) return;
  await createAdminClient().from("kampagnen_werbekonto").delete().eq("company_id", companyId).eq("id", text(fd, "id"));
  neuLaden(companyId);
}

export async function manuelleKostenSpeichern(_v: AktionsStatus, fd: FormData): Promise<AktionsStatus> {
  const companyId = await firmaPruefen(fd);
  if (!companyId) return FEHLER("Firma nicht gefunden.");
  const monat = text(fd, "monat");
  if (!istMonat(monat)) return FEHLER("Bitte einen Monat wählen.");
  const betrag = Number(text(fd, "betrag").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(betrag) || betrag < 0) return FEHLER("Bitte einen Betrag in Euro eingeben.");
  const { error } = await createAdminClient()
    .from("manuelle_kosten")
    .insert({ company_id: companyId, monat: `${monat}-01`, betrag: Math.round(betrag * 100) / 100, notiz: text(fd, "notiz") || null });
  if (error) return FEHLER(`Speichern fehlgeschlagen: ${error.message}`);
  neuLaden(companyId);
  return OK("Kosten gespeichert.");
}

export async function manuelleKostenLoeschen(fd: FormData): Promise<void> {
  const companyId = await firmaPruefen(fd);
  if (!companyId) return;
  await createAdminClient().from("manuelle_kosten").delete().eq("company_id", companyId).eq("id", text(fd, "id"));
  neuLaden(companyId);
}

export async function jetztAbgleichen(_v: AktionsStatus, fd: FormData): Promise<AktionsStatus> {
  const companyId = await firmaPruefen(fd);
  if (!companyId) return FEHLER("Firma nicht gefunden.");
  try {
    const e = await syncKampagnenMitLog(createAdminClient(), { companyId });
    neuLaden(companyId);
    if (e.fehler.length) return FEHLER(`Abgleich mit Hinweisen: ${e.fehler.join(" · ")}`);
    return OK(`Abgeglichen: ${e.zeilen} Tageswerte der letzten 30 Tage.`);
  } catch (err) {
    return FEHLER(`Abgleich fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
  }
}
