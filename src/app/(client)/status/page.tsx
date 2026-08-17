import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Globe, Megaphone, Activity, Package, ExternalLink } from "lucide-react";

export const metadata: Metadata = { title: "Projektstatus" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  backlog: "Geplant",
  in_arbeit: "In Arbeit",
  review: "Review",
  live: "Live",
};

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  backlog: "outline",
  in_arbeit: "default",
  review: "secondary",
  live: "default",
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

interface ProjectRow {
  id: string;
  typ: string;
  status: string;
  live_url: string | null;
  project_tasks: { id: string; status: string }[];
}

export default async function KundenStatusPage() {
  const profile = await requireRole(["admin", "client_owner", "client_member"]);
  const supabase = await createClient();

  const companyId = profile.company_id;
  if (!companyId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Projektstatus</h1>
        <p className="text-sm text-muted-foreground">
          Dein Konto ist noch keinem Unternehmen zugeordnet.
        </p>
      </div>
    );
  }

  const { data } = await supabase
    .from("projects")
    .select("id, typ, status, live_url, project_tasks(id, status)")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  const projects = (data as unknown as ProjectRow[]) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Projektstatus</h1>
        <p className="text-sm text-muted-foreground">
          Transparenter Überblick über den Fortschritt deiner Projekte.
        </p>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium">Noch keine Projekte</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sobald dein Onboarding abgeschlossen ist, erscheinen hier deine
            Projekte.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => {
            const Icon = TYP_ICONS[project.typ] ?? Package;
            const totalTasks = project.project_tasks.length;
            const doneTasks = project.project_tasks.filter(
              (t) => t.status === "erledigt"
            ).length;
            const progressPct =
              totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

            return (
              <div
                key={project.id}
                className="rounded-lg border bg-card p-4 space-y-3"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {TYP_LABELS[project.typ] ?? project.typ}
                    </span>
                  </div>
                  <Badge
                    variant={STATUS_BADGE_VARIANT[project.status] ?? "outline"}
                  >
                    {STATUS_LABELS[project.status] ?? project.status}
                  </Badge>
                </div>

                {/* Fortschritt */}
                {totalTasks > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Fortschritt</span>
                      <span className="font-mono">
                        {doneTasks}/{totalTasks} ({progressPct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Live-URL */}
                {project.live_url && (
                  <a
                    href={project.live_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Live ansehen
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
