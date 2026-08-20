import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/lead-utils";
import type { Lead, LeadSla, SlaAmpel } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Dashboard",
};

export const dynamic = "force-dynamic";

const AMPEL_STYLES: Record<SlaAmpel, string> = {
  gruen: "text-sla-gruen",
  gelb: "text-sla-gelb",
  rot: "text-sla-rot",
};

function formatMinuten(min: number): string {
  if (min < 60) return `${Math.round(min)} Min.`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m}m`;
}

export default async function ClientDashboardPage() {
  const supabase = await createClient();

  const companyId = null;
  if (!companyId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Dein Konto ist noch keinem Unternehmen zugeordnet.
        </p>
      </div>
    );
  }

  const [leadsResult, slaResult] = await Promise.all([
    supabase
      .from("leads")
      .select("id, status, auftragswert, created_at, first_contact_at")
      .eq("company_id", companyId),
    supabase
      .from("lead_sla")
      .select("reaktionszeit_minuten, ampel, first_contact_at")
      .eq("company_id", companyId),
  ]);

  const leads = (leadsResult.data as Pick<Lead, "id" | "status" | "auftragswert" | "created_at" | "first_contact_at">[]) ?? [];
  const slaData = (slaResult.data as Pick<LeadSla, "reaktionszeit_minuten" | "ampel" | "first_contact_at">[]) ?? [];

  const total = leads.length;
  const offen = leads.filter(
    (l) => !["gewonnen", "verloren", "kein_interesse"].includes(l.status)
  ).length;
  const gewonnen = leads.filter((l) => l.status === "gewonnen").length;
  const verloren = leads.filter((l) => l.status === "verloren").length;
  const abschlussquote =
    gewonnen + verloren > 0
      ? ((gewonnen / (gewonnen + verloren)) * 100).toFixed(0)
      : "—";
  const auftragsvolumen = leads
    .filter((l) => l.auftragswert != null)
    .reduce((sum, l) => sum + (l.auftragswert ?? 0), 0);

  const kontaktiert = slaData.filter((s) => s.first_contact_at != null);
  const avgReaktionszeit =
    kontaktiert.length > 0
      ? kontaktiert.reduce((sum, s) => sum + s.reaktionszeit_minuten, 0) /
        kontaktiert.length
      : 0;
  const avgAmpel: SlaAmpel =
    avgReaktionszeit < 15 ? "gruen" : avgReaktionszeit < 60 ? "gelb" : "rot";

  const kpis = [
    { label: "Leads gesamt", value: total.toString() },
    { label: "Offen", value: offen.toString() },
    { label: "Gewonnen", value: gewonnen.toString() },
    {
      label: "Abschlussquote",
      value: abschlussquote === "—" ? "—" : `${abschlussquote}%`,
    },
    {
      label: "Auftragsvolumen",
      value: auftragsvolumen > 0 ? formatCurrency(auftragsvolumen) : "—",
    },
    {
      label: "Ø Reaktionszeit",
      value: kontaktiert.length > 0 ? formatMinuten(avgReaktionszeit) : "—",
      className: kontaktiert.length > 0 ? AMPEL_STYLES[avgAmpel] : "",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dein Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Übersicht über deine Leads und Kennzahlen.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-lg border bg-card p-4 text-card-foreground"
          >
            <p className="text-xs text-muted-foreground">{kpi.label}</p>
            <p
              className={cn(
                "mt-1 text-2xl font-bold font-mono",
                "className" in kpi && kpi.className
              )}
            >
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {total === 0 && (
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium">Noch keine Leads</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sobald deine Kampagne live ist, erscheinen hier deine Anfragen.
          </p>
        </div>
      )}
    </div>
  );
}
