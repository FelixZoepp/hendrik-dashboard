"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { istFreigeschaltet, schalteFrei, sperre } from "@/lib/whatsapp/admin";
import {
  ladeVerlustgrundEinstellungen,
  legeVerlustgrundFelderAn,
  speichereVerlustgrundWert,
} from "@/lib/verlustgrund/automatik";

const PFAD = "/sales/verlustgrund";

function zurueck(meldung: string, fehler = false): never {
  revalidatePath(PFAD);
  redirect(`${PFAD}?${fehler ? "fehler" : "meldung"}=${encodeURIComponent(meldung)}`);
}

async function nurFreigeschaltet() {
  if (!(await istFreigeschaltet())) zurueck("Bitte zuerst mit der Admin-PIN freischalten.", true);
}

export async function pinAktion(formData: FormData) {
  const r = await schalteFrei(String(formData.get("pin") ?? ""));
  zurueck(r.meldung, !r.ok);
}

export async function sperrenAktion() {
  await sperre();
  zurueck("Gesperrt.");
}

export async function schalterAktion(formData: FormData) {
  await nurFreigeschaltet();
  const name = String(formData.get("name") ?? "");
  if (name !== "verlustgrund_automatisch" && name !== "verlustgrund_aufgabe") zurueck("Unbekannter Schalter.", true);
  const an = formData.get("an") === "1";
  const svc = createAdminClient();
  if (an) {
    const e = await ladeVerlustgrundEinstellungen(svc);
    if (!e.verlustgrundFeld) zurueck("Erst „Felder in Close anlegen“ – ohne Opportunity-Feld bleibt der Schalter aus.", true);
    if (name === "verlustgrund_automatisch" && !e.settingGrundFeld && !e.closingGrundFeld) {
      zurueck("Erst „Felder in Close anlegen“ – ohne Grund-Feld im Protokoll gibt es nichts zu übernehmen.", true);
    }
  }
  await speichereVerlustgrundWert(svc, name, an);
  zurueck(`${name === "verlustgrund_automatisch" ? "Grund aus dem Protokoll" : "Verlustgrund-Aufgabe"} ${an ? "eingeschaltet" : "ausgeschaltet"}.`);
}

export async function felderAnlegenAktion() {
  await nurFreigeschaltet();
  let bericht: string[];
  try {
    bericht = await legeVerlustgrundFelderAn(createAdminClient());
  } catch (err) {
    zurueck(`Felder anlegen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  zurueck(bericht.join(" · "), bericht.some((b) => b.includes("Fehler")));
}
