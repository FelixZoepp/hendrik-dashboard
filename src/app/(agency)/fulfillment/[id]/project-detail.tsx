"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader2,
  BookOpen,
  Plus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const PROJECT_STATUSES = ["backlog", "in_arbeit", "review", "live"] as const;
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
  in_arbeit: { label: "In Arbeit", icon: Loader2, color: "text-primary" },
  erledigt: { label: "Erledigt", icon: CheckCircle2, color: "text-success" },
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
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitel, setNewTaskTitel] = useState("");
  const [newTaskBeschreibung, setNewTaskBeschreibung] = useState("");
  const [addingTask, setAddingTask] = useState(false);

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

  async function changeProjectStatus(newStatus: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("projects")
      .update({ status: newStatus })
      .eq("id", project.id);

    if (error) {
      toast.error("Status konnte nicht geändert werden");
      return;
    }
    toast.success(`Projekt auf „${STATUS_LABELS[newStatus]}" gesetzt`);
    router.refresh();
  }

  async function handleAddTask() {
    if (!newTaskTitel.trim()) return;
    setAddingTask(true);

    const supabase = createClient();
    const { error } = await supabase.from("project_tasks").insert({
      project_id: project.id,
      titel: newTaskTitel.trim(),
      beschreibung: newTaskBeschreibung.trim() || null,
      position: tasks.length,
    });

    if (error) {
      toast.error("Aufgabe konnte nicht erstellt werden");
      setAddingTask(false);
      return;
    }

    toast.success("Aufgabe erstellt");
    setNewTaskTitel("");
    setNewTaskBeschreibung("");
    setShowAddTask(false);
    setAddingTask(false);
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
            {/* Projekt-Status ändern */}
            <Select
              value={project.status}
              onValueChange={(v) => v && changeProjectStatus(v)}
            >
              <SelectTrigger className="h-6 w-auto gap-1 px-2 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      {project.live_url && (
        <p className="text-sm">
          <span className="text-muted-foreground">Live: </span>
          <a
            href={project.live_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {project.live_url}
          </a>
        </p>
      )}

      <Separator />

      {/* Task-Liste */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">Aufgaben</h2>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => setShowAddTask(true)}
          >
            <Plus className="mr-1.5 h-3 w-3" />
            Aufgabe
          </Button>
        </div>
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
                    onClick={() => toggleTaskStatus(task.id, task.status)}
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

      {/* Aufgabe hinzufügen Dialog */}
      <Dialog open={showAddTask} onOpenChange={setShowAddTask}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neue Aufgabe</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Titel *</Label>
              <Input
                value={newTaskTitel}
                onChange={(e) => setNewTaskTitel(e.target.value)}
                placeholder="Was muss erledigt werden?"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Beschreibung</Label>
              <Input
                value={newTaskBeschreibung}
                onChange={(e) => setNewTaskBeschreibung(e.target.value)}
                placeholder="Details (optional)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddTask(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={handleAddTask}
              disabled={addingTask || !newTaskTitel.trim()}
            >
              {addingTask ? "Wird erstellt…" : "Erstellen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
