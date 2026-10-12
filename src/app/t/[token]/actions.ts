"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { bestaetigeTermin, verschiebeWunsch } from "@/lib/whatsapp/antworten";
import { ladeTerminPerToken } from "@/lib/whatsapp/termine";

/** Knopf „Termin bestätigen“ auf der Termin-Seite — wirkt wie „Ich bin dabei“. */
export async function bestaetigenAktion(token: string) {
  const svc = createAdminClient();
  const termin = await ladeTerminPerToken(svc, token);
  if (termin) await bestaetigeTermin(svc, termin, { quelle: "seite" });
  redirect(`/t/${encodeURIComponent(token)}?ok=bestaetigt`);
}

/** Knopf „Termin verschieben“ ohne Calendly-Link → Close-Aufgabe, Hinweis „wir melden uns“. */
export async function verschiebenAktion(token: string) {
  const svc = createAdminClient();
  const termin = await ladeTerminPerToken(svc, token);
  if (termin && !termin.verschieben_am) await verschiebeWunsch(svc, termin, { quelle: "seite" });
  redirect(`/t/${encodeURIComponent(token)}?ok=verschieben`);
}
