import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sales",
};

export default function SalesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sales-Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Übersicht über Leads, Termine und Abschlüsse.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {["Leads neu", "Termine gebucht", "Closes", "Umsatz"].map((label) => (
          <div
            key={label}
            className="rounded-lg border bg-card p-4 text-card-foreground"
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold font-mono">—</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Daten werden nach Anbindung von Close und Calendly geladen (Phase 2).
      </p>
    </div>
  );
}
