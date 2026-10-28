"use server";

import { revalidatePath } from "next/cache";
import { requireKunde } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { fehlendeSpalte } from "@/lib/zugaenge";
import { istUuid } from "@/lib/zugriff";
import { ladeKundenStand } from "@/lib/masterclass/daten";

export interface FortschrittErgebnis {
  fehler: string | null;
}

const VORSCHAU = "Vorschau („Als Kunde ansehen“): Fortschritt wird nicht gespeichert.";

/** Lektion als erledigt / offen markieren — nur für echte Kunden-Konten, nie bei Impersonation. */
export async function lektionErledigt(lessonId: string, erledigt: boolean): Promise<FortschrittErgebnis> {
  const ctx = await requireKunde();
  if (ctx.impersoniert) return { fehler: VORSCHAU };
  if (!istUuid(lessonId)) return { fehler: "Lektion nicht gefunden." };

  try {
    const db = createAdminClient();
    const stand = await ladeKundenStand(db, ctx);
    if (!stand.lektionen.some((l) => l.id === lessonId)) return { fehler: "Lektion nicht gefunden." };
    if (stand.lektionSperre.get(lessonId)?.gesperrt) return { fehler: "Diese Lektion ist noch gesperrt." };

    if (erledigt) {
      const zeile = {
        user_id: ctx.profile.id,
        lesson_id: lessonId,
        company_id: ctx.companyId,
        abgeschlossen_am: new Date().toISOString(),
      };
      let { error } = await db.from("lesson_progress").upsert(zeile, { onConflict: "user_id,lesson_id" });
      if (fehlendeSpalte(error)) {
        const { company_id: _ohne, ...ohneFirma } = zeile;
        void _ohne;
        ({ error } = await db.from("lesson_progress").upsert(ohneFirma, { onConflict: "user_id,lesson_id" }));
      }
      if (error) return { fehler: "Konnte nicht gespeichert werden." };
    } else {
      const { error } = await db.from("lesson_progress").delete().eq("user_id", ctx.profile.id).eq("lesson_id", lessonId);
      if (error) return { fehler: "Konnte nicht gespeichert werden." };
    }
  } catch {
    return { fehler: "Konnte nicht gespeichert werden." };
  }

  revalidatePath("/akademie", "layout");
  return { fehler: null };
}

/** Aufgabe einer Lektion abhaken. */
export async function aufgabeErledigt(taskId: string, erledigt: boolean): Promise<FortschrittErgebnis> {
  const ctx = await requireKunde();
  if (ctx.impersoniert) return { fehler: VORSCHAU };
  if (!istUuid(taskId)) return { fehler: "Aufgabe nicht gefunden." };

  try {
    const db = createAdminClient();
    const { data: aufgabe } = await db.from("lesson_tasks").select("lesson_id").eq("id", taskId).maybeSingle();
    const lessonId = (aufgabe as { lesson_id: string } | null)?.lesson_id;
    if (!lessonId) return { fehler: "Aufgabe nicht gefunden." };
    const stand = await ladeKundenStand(db, ctx);
    if (!stand.lektionen.some((l) => l.id === lessonId) || stand.lektionSperre.get(lessonId)?.gesperrt) {
      return { fehler: "Aufgabe nicht verfügbar." };
    }

    const { error } = erledigt
      ? await db.from("lesson_task_progress").upsert(
          { user_id: ctx.profile.id, task_id: taskId, company_id: ctx.companyId, erledigt_am: new Date().toISOString() },
          { onConflict: "user_id,task_id" },
        )
      : await db.from("lesson_task_progress").delete().eq("user_id", ctx.profile.id).eq("task_id", taskId);
    if (error) return { fehler: "Konnte nicht gespeichert werden." };
  } catch {
    return { fehler: "Konnte nicht gespeichert werden." };
  }

  revalidatePath("/akademie", "layout");
  return { fehler: null };
}
