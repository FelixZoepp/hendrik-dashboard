import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

export type AktivierenErgebnis = { ok: true; projekteAngelegt: number } | { ok: false; fehler: string };

/**
 * Firma aktivieren: status = aktiv + start_datum, dann je Projekt-Template ein Projekt mit Aufgaben.
 * Genutzt von /api/automation/activate-company (CRON_SECRET) und vom After-Close-Formular (Server Action).
 */
export async function firmaAktivieren(db: Db, companyId: string): Promise<AktivierenErgebnis> {
  const { error: updateError } = await db
    .from("companies")
    .update({ status: "aktiv", start_datum: new Date().toISOString() })
    .eq("id", companyId);
  if (updateError) return { ok: false, fehler: `Company update failed: ${updateError.message}` };

  const { data: templates, error: templatesError } = await db.from("project_templates").select("*");
  if (templatesError) return { ok: false, fehler: `Templates fetch failed: ${templatesError.message}` };

  let projekteAngelegt = 0;
  for (const template of templates ?? []) {
    const { data: project, error: projectError } = await db
      .from("projects")
      .insert({ company_id: companyId, typ: template.typ, status: "backlog" })
      .select("id")
      .single();

    if (projectError || !project) {
      console.error(`Projekt-Erstellung fehlgeschlagen für Template ${template.id}:`, projectError?.message);
      continue;
    }

    const tasks = (template.tasks as { titel: string; beschreibung?: string; position?: number }[]) ?? [];
    if (tasks.length > 0) {
      const { error: tasksError } = await db.from("project_tasks").insert(
        tasks.map((task, index) => ({
          project_id: project.id,
          titel: task.titel,
          beschreibung: task.beschreibung ?? null,
          status: "offen",
          position: task.position ?? index,
        })),
      );
      if (tasksError) console.error(`Tasks-Erstellung fehlgeschlagen für Projekt ${project.id}:`, tasksError.message);
    }
    projekteAngelegt++;
  }

  return { ok: true, projekteAngelegt };
}
