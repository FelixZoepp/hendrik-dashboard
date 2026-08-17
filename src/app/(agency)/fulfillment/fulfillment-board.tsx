"use client";

import { useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Globe,
  Megaphone,
  Activity,
  Package,
  CheckCircle2,
} from "lucide-react";

const PROJECT_STATUS = ["backlog", "in_arbeit", "review", "live"] as const;
const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  in_arbeit: "In Arbeit",
  review: "Review",
  live: "Live",
};

const TYP_ICONS: Record<string, typeof Globe> = {
  website: Globe,
  google_ads: Megaphone,
  tracking: Activity,
  sonstiges: Package,
};

const TYP_LABELS: Record<string, string> = {
  website: "Website",
  google_ads: "Google Ads",
  tracking: "Tracking",
  sonstiges: "Sonstiges",
};

interface Project {
  id: string;
  company_id: string;
  typ: string;
  status: string;
  deadline: string | null;
  live_url: string | null;
  notizen: string | null;
  project_tasks: { id: string; status: string }[];
  companies: { name: string };
}

interface Company {
  id: string;
  name: string;
  status: string;
}

interface FulfillmentBoardProps {
  projects: Project[];
  companies: Company[];
  currentUserId: string;
  isAdmin: boolean;
}

export function FulfillmentBoard({
  projects,
  companies,
}: FulfillmentBoardProps) {
  const columns = useMemo(() => {
    return PROJECT_STATUS.map((status) => ({
      status,
      label: STATUS_LABELS[status],
      projects: projects.filter((p) => p.status === status),
    }));
  }, [projects]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fulfillment</h1>
          <p className="text-sm text-muted-foreground">
            {projects.length} Projekte · {companies.length} aktive Kunden
          </p>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((col) => (
          <div
            key={col.status}
            className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/50"
          >
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
              <span className="text-xs font-medium">{col.label}</span>
              <span className="text-xs font-mono text-muted-foreground tabular-nums">
                {col.projects.length}
              </span>
            </div>
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-2">
                {col.projects.length === 0 ? (
                  <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                    Keine Projekte
                  </p>
                ) : (
                  col.projects.map((project) => {
                    const Icon = TYP_ICONS[project.typ] ?? Package;
                    const totalTasks = project.project_tasks.length;
                    const doneTasks = project.project_tasks.filter(
                      (t) => t.status === "erledigt"
                    ).length;

                    return (
                      <Link
                        key={project.id}
                        href={`/fulfillment/${project.id}`}
                        className="block rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {project.companies?.name}
                            </p>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Icon className="h-3 w-3" />
                              {TYP_LABELS[project.typ]}
                            </div>
                          </div>
                          {project.deadline && (
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {new Date(project.deadline).toLocaleDateString(
                                "de-DE",
                                { day: "2-digit", month: "2-digit" }
                              )}
                            </Badge>
                          )}
                        </div>
                        {totalTasks > 0 && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{
                                  width: `${(doneTasks / totalTasks) * 100}%`,
                                }}
                              />
                            </div>
                            <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-0.5">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              {doneTasks}/{totalTasks}
                            </span>
                          </div>
                        )}
                      </Link>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        ))}
      </div>
    </div>
  );
}
