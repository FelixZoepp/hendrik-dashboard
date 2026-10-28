"use server";

import { revalidatePath } from "next/cache";
import { requireKunde } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { tabelleFehlt } from "@/lib/auswertung/erfassung";
import { neuerToken } from "@/lib/eingang/logik";
import { pruefeBuchungslink } from "@/lib/kalender/logik";

// Regel (siehe src/lib/kontext.ts): requireKunde() zuerst, Service-Client, company_id NUR aus ctx.
// Beim „Als Kunde ansehen“ erlaubt: der Knopf ist eine bewusste Handlung des Teams.

export interface KalenderStatus {
  fehler: string | null;
  meldung: string | null;
}

const EINRICHTUNG = "Der Kalender wird gerade eingerichtet. Bitte später nochmal versuchen.";

function neuLaden() {
  revalidatePath("/kalender", "page");
  revalidatePath("/dashboard", "page");
}

/** Erzeugt (oder ersetzt) den geheimen Abo-Link. Der alte Link ist danach sofort ungültig. */
export async function kalenderLinkErzeugen(): Promise<KalenderStatus> {
  const ctx = await requireKunde();
  try {
    const db = createAdminClient();
    const { error } = await db.from("kalender_abos").upsert(
      {
        company_id: ctx.companyId,
        token: neuerToken(32),
        token_erzeugt_am: new Date().toISOString(),
        token_erzeugt_von: ctx.profile.id,
        // neuer Link → muss neu im Kalender eingetragen werden
        letzter_abruf_am: null,
        abrufe: 0,
      },
      { onConflict: "company_id" },
    );
    if (error) return { fehler: tabelleFehlt(error) ? EINRICHTUNG : "Hat nicht geklappt. Bitte nochmal versuchen.", meldung: null };
  } catch {
    return { fehler: "Hat nicht geklappt. Bitte nochmal versuchen.", meldung: null };
  }
  neuLaden();
  return { fehler: null, meldung: "Neuer Link ist fertig." };
}

/** Eigener Buchungslink (Calendly, Google-Terminbuchung …). Leer = entfernen. */
export async function buchungslinkSpeichern(_vorher: KalenderStatus, formData: FormData): Promise<KalenderStatus> {
  const ctx = await requireKunde();
  const { wert, fehler } = pruefeBuchungslink(String(formData.get("buchungslink") ?? ""));
  if (fehler) return { fehler, meldung: null };
  try {
    const db = createAdminClient();
    const { error } = await db
      .from("kalender_abos")
      .upsert({ company_id: ctx.companyId, buchungslink: wert }, { onConflict: "company_id" });
    if (error) return { fehler: tabelleFehlt(error) ? EINRICHTUNG : "Konnte nicht gespeichert werden.", meldung: null };
  } catch {
    return { fehler: "Konnte nicht gespeichert werden.", meldung: null };
  }
  neuLaden();
  revalidatePath("/leads", "layout");
  return { fehler: null, meldung: wert ? "Buchungslink gespeichert." : "Buchungslink entfernt." };
}
