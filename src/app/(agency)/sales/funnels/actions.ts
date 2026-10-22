"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { istFreigeschaltet, schalteFrei, sperre } from "@/lib/whatsapp/admin";
import { ladeFunnelEinstellungen, speichereFunnelWert } from "@/lib/funnel/einstellungen";
import { funnelKey, leseFunnels, STANDARD_FUNNEL } from "@/lib/funnel/logik";

const PFAD = "/sales/funnels";

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
  if (name !== "funnel_close_aktiv" && name !== "funnel_whatsapp_aktiv") zurueck("Unbekannter Schalter.", true);
  const an = formData.get("an") === "1";
  await speichereFunnelWert(createAdminClient(), name, an);
  zurueck(`${name === "funnel_close_aktiv" ? "Close-Übernahme" : "WhatsApp (Report + Erinnerung)"} ${an ? "eingeschaltet" : "ausgeschaltet"}.`);
}

const feld = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};

export async function funnelSpeichernAktion(formData: FormData) {
  await nurFreigeschaltet();
  const svc = createAdminClient();
  const e = await ladeFunnelEinstellungen(svc);
  const neu = formData.get("neu") === "1";
  const key = neu ? funnelKey(feld(formData, "key") ?? feld(formData, "name")) : String(formData.get("key") ?? "");
  if (!/^[a-z0-9-]{1,40}$/.test(key)) zurueck("Ungültiger Kurzname (nur a–z, 0–9, -).", true);
  if (neu && e.funnels[key]) zurueck(`Funnel „${key}“ gibt es schon.`, true);

  for (const k of ["report_url", "buchungslink"]) {
    const v = feld(formData, k);
    if (v && !/^https:\/\/\S+$/.test(v)) zurueck(`${k === "report_url" ? "PDF-Link" : "Buchungslink"} muss mit https:// beginnen.`, true);
  }
  const roh = {
    ...(e.funnels[key] ?? STANDARD_FUNNEL),
    name: feld(formData, "name") ?? key,
    ...(neu
      ? {}
      : {
          report_url: feld(formData, "report_url"),
          report_titel: feld(formData, "report_titel"),
          report_dateiname: feld(formData, "report_dateiname"),
          buchungslink: feld(formData, "buchungslink"),
          erinnerung: formData.get("erinnerung") === "1",
          einwilligung_ohne_haekchen: formData.get("einwilligung_ohne_haekchen") === "1",
          zustaendig: feld(formData, "zustaendig"),
        }),
  };
  const gelesen = leseFunnels({ [key]: roh })[key];
  await speichereFunnelWert(svc, "funnels", { ...e.funnels, [key]: gelesen });
  zurueck(neu ? `Funnel „${gelesen.name}“ angelegt – Webhook-URL steht unten.` : `Funnel „${gelesen.name}“ gespeichert.`);
}

export async function funnelLoeschenAktion(formData: FormData) {
  await nurFreigeschaltet();
  const svc = createAdminClient();
  const e = await ladeFunnelEinstellungen(svc);
  const key = String(formData.get("key") ?? "");
  if (!e.funnels[key]) zurueck("Funnel nicht gefunden.", true);
  const rest = { ...e.funnels };
  delete rest[key];
  await speichereFunnelWert(svc, "funnels", rest);
  zurueck(`Funnel „${key}“ entfernt (Eintragungen bleiben erhalten).`);
}
