import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Circle, Loader2, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Meine Aufgaben" };
export const dynamic = "force-dynamic";

const TASK_STATUS_CONFIG: Record<
  string,
  { label: string; icon: typeof Circle; color: string; badgeVariant: "default" | "secondary" | "outline" }
> = {
  offen: {
    label: "Offen",
    icon: Circle,
    color: "text-muted-foreground",
    badgeVariant: "outline",
  },
  in_arbeit: {
    label: "In Arbeit",
    icon: Loader2,
    color: "text-primary",
    badgeVariant: "default",
  },
  erledigt: {
    label: "Erledigt",
    icon: CheckCircle2,
    color: "text-success",
    badgeVariant: "secondary",
  },
};

const STATUS_ORDER = ["offen", "in_arbeit", "erledigt"];

interface TaskRow {
  id: string;
  titel: string;
  status: string;
  due_date: string | null;
  project_id: string;
  projects: {
    typ: string;
    companies: { name: string };
  };
}

export default async function MeineAufgabenPage() {
  const profile = await requireRole(["admin", "fulfillment"]);
  const supabase = await createClient();

  const { data: tasks } = await supabase
    .from("project_tasks")
    .select("id, titel, status, due_date, project_id, projects(typ, companies(name))")
    .eq("assignee", profile.id)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("status", { ascending: true });

  const allTasks = (tasks as unknown as TaskRow[]) ?? [];

  // Nach Status gruppieren
  const grouped = STATUS_ORDER.map((status) => ({
    status,
    config: TASK_STATUS_CONFIG[status],
    tasks: allTasks.filter((t) => t.status === status),
  }));

  const totalTasks = allTasks.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Meine Aufgaben</h1>
        <p className="text-sm text-muted-foreground">
          {totalTasks} Aufgabe{totalTasks !== 1 ? "n" : ""} zugewiesen
        </p>
      </div>

      {totalTasks === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium">Keine Aufgaben</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Dir sind aktuell keine Aufgaben zugewiesen.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped
            .filter((group) => group.tasks.length > 0)
            .map((group) => {
              const Icon = group.config.icon;
              return (
                <div key={group.status}>
                  <div className="mb-3 flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${group.config.color}`} />
                    <h2 className="text-sm font-semibold">
                      {group.config.label}
                    </h2>
                    <span className="text-xs font-mono text-muted-foreground">
                      {group.tasks.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {group.tasks.map((task) => (
                      <Link
                        key={task.id}
                        href={`/fulfillment/${task.project_id}`}
                        className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {task.titel}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {task.projects?.companies?.name} &middot;{" "}
                            {task.projects?.typ}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          {task.due_date && (
                            <span className="text-xs text-muted-foreground font-mono">
                              {new Date(task.due_date).toLocaleDateString(
                                "de-DE",
                                {
                                  day: "2-digit",
                                  month: "2-digit",
                                }
                              )}
                            </span>
                          )}
                          <Badge variant={group.config.badgeVariant}>
                            {group.config.label}
                          </Badge>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
