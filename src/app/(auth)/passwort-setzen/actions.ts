"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface PasswortStatus {
  fehler: string | null;
}

export async function passwortSetzen(_vorher: PasswortStatus, formData: FormData): Promise<PasswortStatus> {
  const passwort = String(formData.get("passwort") ?? "");
  const wiederholung = String(formData.get("wiederholung") ?? "");
  const tokenHash = String(formData.get("token_hash") ?? "");
  const typ = String(formData.get("type") ?? "");

  if (passwort.length < 8) return { fehler: "Das Passwort braucht mindestens 8 Zeichen." };
  if (passwort !== wiederholung) return { fehler: "Die beiden Passwörter sind nicht gleich." };

  const supabase = await createClient();

  if (tokenHash) {
    if (typ !== "invite" && typ !== "recovery") return { fehler: "Der Link ist ungültig." };
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: typ });
    if (error) {
      return { fehler: "Der Link ist abgelaufen oder wurde schon benutzt. Bitte fordere einen neuen an." };
    }
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { fehler: "Der Link fehlt. Bitte öffne den Link, den du bekommen hast." };
  }

  const { error } = await supabase.auth.updateUser({ password: passwort });
  if (error) {
    const t = error.message.toLowerCase();
    if (t.includes("different from the old")) return { fehler: "Bitte wähle ein anderes Passwort als bisher." };
    if (t.includes("weak") || t.includes("characters")) return { fehler: "Das Passwort ist zu einfach. Bitte nimm ein längeres." };
    return { fehler: "Passwort konnte nicht gespeichert werden. Bitte versuch es noch einmal." };
  }

  redirect("/");
}
