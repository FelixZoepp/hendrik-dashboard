"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader2,
  BookOpen,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  in_arbeit: "In Arbeit",
  review: "Review",
  live: "Live",
};

const TASK_STATUS: Record<
  string,
  { label: string; icon: typeof Circle; color: string }
> = {
  offen: { label: "Offen", icon: Circle, color: "text-muted-foreground" },
  in_arbeit: {
    label: "In Arbeit",
    icon: Loader2,
    color: "text-primary",
  },
  erledigt: {
    label: "Erledigt",
    icon: CheckCircle2,
    color: "text-success",
  },
};

interface Task {
  id: string;
  titel: string;
  beschreibung: string | null;
  status: string;
  position: number;
  sop_id: string | null;
  sops: { id: string; titel: string } | null;
}

interface ProjectDetailProps {
  project: {
    id: string;
    typ: string;
    status: string;
    deadline: string | null;
    live_url: string | null;
    notizen: string | null;
    companies: { name: string };
    project_tasks: Task[];
  };
  sops: { id: string; titel: string; kategorie: string }[];
}

export function ProjectDetail({ project, sops }: ProjectDetailProps) {
  const router = useRouter();
  const tasks = [...project.project_tasks].sort(
    (a, b) => a.position - b.position
  );
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "erledigt").length;

  async function toggleTaskStatus(taskId: string, currentStatus: string) {
    const nextStatus =
      currentStatus === "offen"
        ? "in_arbeit"
        : currentStatus === "in_arbeit"
          ? "erledigt"
          : "offen";

    const supabase = createClient();
    const { error } = await supabase
      .from("project_tasks")
      .update({ status: nextStatus })
      .eq("id", taskId);

    if (error) {
      toast.error("Fehler beim Aktualisieren");
      return;
    }

    router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/fulfillment"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Zurück zum Board
      </Link>

      {/* Kopf */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {project.companies?.name}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline">{project.typ}</Badge>
            <Badge variant="secondary">
              {STATUS_LABELS[project.status]}
            </Badge>
            {project.deadline && (
              <span className="text-xs text-muted-foreground">
                Deadline:{" "}
                {new Date(project.deadline).toLocaleDateString("de-DE")}
              </span>
            )}
          </div>
        </div>
        {totalTasks > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <div className="w-24 h-2 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${(doneTasks / totalTasks) * 100}%`,
                }}
              />
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {doneTasks}/{totalTasks}
            </span>
          </div>
        )}
      </div>

      {project.notizen && (
        <p className="text-sm text-muted-foreground">{project.notizen}</p>
      )}

      <Separator />

      {/* Task-Liste */}
      <div>
        <h2 className="text-sm font-medium mb-3">Aufgaben</h2>
        {tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Keine Aufgaben angelegt.
            </p>
          </div>
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {tasks.map((task) => {
              const statusConfig =
                TASK_STATUS[task.status] ?? TASK_STATUS.offen;
              const StatusIcon = statusConfig.icon;

              return (
                <div
                  key={task.id}
                  className="flex items-start gap-3 px-3 py-2.5"
                >
                  <button
                    onClick={() =>
                      toggleTaskStatus(task.id, task.status)
                    }
                    className={cn(
                      "mt-0.5 shrink-0 transition-colors hover:text-primary",
                      statusConfig.color
                    )}
                  >
                    <StatusIcon className="h-4 w-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm",
                        task.status === "erledigt" &&
                          "line-through text-muted-foreground"
                      )}
                    >
                      {task.titel}
                    </p>
                    {task.beschreibung && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {task.beschreibung}
                      </p>
                    )}
                  </div>
                  {task.sops && (
                    <Link
                      href={`/sops/${task.sops.id}`}
                      className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                    >
                      <BookOpen className="h-3 w-3" />
                      SOP
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
