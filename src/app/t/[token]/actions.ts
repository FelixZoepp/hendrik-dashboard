"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { bestaetigeTermin } from "@/lib/whatsapp/antworten";
import { ladeTerminPerToken } from "@/lib/whatsapp/termine";

/** Knopf „Termin bestätigen“ auf der Termin-Seite — wirkt wie „Ich bin dabei“. */
export async function bestaetigenAktion(token: string) {
  const svc = createAdminClient();
  const termin = await ladeTerminPerToken(svc, token);
  if (termin) await bestaetigeTermin(svc, termin, { quelle: "seite" });
  redirect(`/t/${encodeURIComponent(token)}?ok=bestaetigt`);
}

