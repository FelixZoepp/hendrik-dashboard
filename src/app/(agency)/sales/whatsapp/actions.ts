"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { istFreigeschaltet, schalteFrei, sperre } from "@/lib/whatsapp/admin";
import { waVerbindung } from "@/lib/whatsapp/client";
import { ladeEinstellungen, speichereEinstellung } from "@/lib/whatsapp/einstellungen";
import { normalisiereTelefon } from "@/lib/whatsapp/logik";
import { gleicheVorlagenAb, reicheVorlageEin } from "@/lib/whatsapp/verwaltung";
import { VORLAGEN_NAMEN } from "@/lib/whatsapp/vorlagen";

const PFAD = "/sales/whatsapp";

function zurueck(meldung: string, fehler = false): never {
  revalidatePath(PFAD);
  redirect(`${PFAD}?${fehler ? "fehler" : "meldung"}=${encodeURIComponent(meldung)}`);
}

async function nurFreigeschaltet() {
  if (!(await istFreigeschaltet())) zurueck("Bitte zuerst mit der Admin-PIN freischalten.", true);
}

const fehlerText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function pinAktion(formData: FormData) {
  const ok = await schalteFrei(String(formData.get("pin") ?? ""));
  zurueck(ok ? "Freigeschaltet (12 Stunden)." : "PIN falsch.", !ok);
}

export async function sperrenAktion() {
  await sperre();
  zurueck("Gesperrt.");
}

export async function hauptschalterAktion(formData: FormData) {
  await nurFreigeschaltet();
  const an = formData.get("an") === "1";
  if (an && !waVerbindung().verbunden) zurueck("WhatsApp ist nicht verbunden — Bot bleibt aus.", true);
  await speichereEinstellung(createAdminClient(), "bot_aktiv", an);
  zurueck(an ? "Bot ist eingeschaltet." : "Bot ist ausgeschaltet.");
}

export async function testnummernAktion(formData: FormData) {
  await nurFreigeschaltet();
  const roh = String(formData.get("testnummern") ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const nummern = [...new Set(roh.map(normalisiereTelefon).filter((n): n is string => !!n))];
  const ungueltig = roh.length - roh.map(normalisiereTelefon).filter(Boolean).length;
  await speichereEinstellung(createAdminClient(), "testnummern", nummern);
  zurueck(`${nummern.length} Testnummer(n) gespeichert${ungueltig ? `, ${ungueltig} ungültige ignoriert` : ""}.`);
}

export async function vorlageSchalterAktion(formData: FormData) {
  await nurFreigeschaltet();
  const name = String(formData.get("name") ?? "");
  if (!VORLAGEN_NAMEN.includes(name as never)) zurueck("Unbekannte Vorlage.", true);
  const svc = createAdminClient();
  const e = await ladeEinstellungen(svc);
  const an = formData.get("an") === "1";
  await speichereEinstellung(svc, "vorlagen_aktiv", { ...e.vorlagen_aktiv, [name]: an });
  zurueck(`${name} ${an ? "eingeschaltet" : "ausgeschaltet"}.`);
}

export async function einreichenAktion(formData: FormData) {
  await nurFreigeschaltet();
  const name = String(formData.get("name") ?? "");
  let meldung: string;
  try {
    const r = await reicheVorlageEin(createAdminClient(), name);
    meldung = `${name} bei Meta eingereicht (Status: ${r.status}).`;
  } catch (err) {
    zurueck(`Einreichen fehlgeschlagen: ${fehlerText(err)}`, true);
  }
  zurueck(meldung);
}

export async function abgleichenAktion() {
  await nurFreigeschaltet();
  let anzahl: number;
  try {
    anzahl = await gleicheVorlagenAb(createAdminClient());
  } catch (err) {
    zurueck(`Abgleich fehlgeschlagen: ${fehlerText(err)}`, true);
  }
  zurueck(`Status von ${anzahl} Vorlage(n) abgeglichen.`);
}

export async function einstellungenAktion(formData: FormData) {
  await nurFreigeschaltet();
  const url = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    if (!v) return null;
    if (!/^https:\/\//.test(v)) zurueck(`„${v}“ ist kein https-Link.`, true);
    return v;
  };
  const svc = createAdminClient();
  await speichereEinstellung(svc, "videos", {
    erstgespraech: url("video_erstgespraech"),
    strategie: url("video_strategie"),
  });
  await speichereEinstellung(svc, "buchungslinks", {
    erstgespraech: url("buchung_erstgespraech"),
    strategie: url("buchung_strategie"),
  });
  const feld = String(formData.get("close_optin_feld") ?? "").trim();
  await speichereEinstellung(svc, "close_optin_feld", feld || null);
  zurueck("Einstellungen gespeichert.");
}
