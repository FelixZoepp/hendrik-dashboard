import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  // CRON_SECRET prüfen (gleicher Pattern wie Cron-Routes)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const companyId = body.company_id;

  if (!companyId || typeof companyId !== "string") {
    return NextResponse.json(
      { error: "company_id is required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // 1. Company auf "aktiv" setzen + start_datum
  const { error: updateError } = await supabase
    .from("companies")
    .update({
      status: "aktiv",
      start_datum: new Date().toISOString(),
    })
    .eq("id", companyId);

  if (updateError) {
    return NextResponse.json(
      { error: `Company update failed: ${updateError.message}` },
      { status: 500 }
    );
  }

  // 2. Alle Projekt-Templates laden
  const { data: templates, error: templatesError } = await supabase
    .from("project_templates")
    .select("*");

  if (templatesError) {
    return NextResponse.json(
      { error: `Templates fetch failed: ${templatesError.message}` },
      { status: 500 }
    );
  }

  let projectsCreated = 0;

  // 3. Für jedes Template ein Projekt + Tasks erzeugen
  for (const template of templates ?? []) {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({
        company_id: companyId,
        typ: template.typ,
        status: "backlog",
      })
      .select("id")
      .single();

    if (projectError || !project) {
      console.error(
        `Projekt-Erstellung fehlgeschlagen für Template ${template.id}:`,
        projectError?.message
      );
      continue;
    }

    // Tasks aus dem Template-JSON erzeugen
    const tasks = (template.tasks as { titel: string; beschreibung?: string; position?: number }[]) ?? [];

    if (tasks.length > 0) {
      const taskInserts = tasks.map((task, index) => ({
        project_id: project.id,
        titel: task.titel,
        beschreibung: task.beschreibung ?? null,
        status: "offen",
        position: task.position ?? index,
      }));

      const { error: tasksError } = await supabase
        .from("project_tasks")
        .insert(taskInserts);

      if (tasksError) {
        console.error(
          `Tasks-Erstellung fehlgeschlagen für Projekt ${project.id}:`,
          tasksError.message
        );
      }
    }

    projectsCreated++;
  }

  return NextResponse.json({ ok: true, projects_created: projectsCreated });
}
