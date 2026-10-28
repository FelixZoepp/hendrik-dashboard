"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatCurrency, quelleLabel } from "@/lib/lead-utils";
import { rueckrufText, stufeVon, stufenInfo } from "@/lib/crm/logik";
import { AlterAmpel } from "@/components/crm/alter-ampel";
import { AnrufenKnopf } from "@/components/crm/kontakt-knoepfe";
import type { Lead } from "@/lib/types/database";

interface LeadListProps {
  leads: Lead[];
  namen?: Record<string, string>;
}

/** Tabellen-Liste (Desktop). */
export function LeadList({ leads, namen }: LeadListProps) {
  if (leads.length === 0) return <KeineLeads />;

  return (
    <div className="fern-card divide-y overflow-hidden">
      {leads.map((lead) => {
        const stufe = stufenInfo(stufeVon(lead.status));
        const wert = stufe.id === "auftrag" ? lead.auftragswert : lead.angebotswert;
        return (
          <div key={lead.id} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent/40">
            <Link href={`/leads/${lead.id}`} className="flex min-w-0 flex-1 items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {lead.vorname} {lead.nachname}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {[lead.plz && lead.ort ? `${lead.plz} ${lead.ort}` : lead.ort, lead.anliegen].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <span className={cn("hidden whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold sm:inline", stufe.farbe)}>
                {stufe.label}
              </span>
              <span className="hidden w-28 text-xs text-muted-foreground lg:block">{quelleLabel(lead.quelle)}</span>
              <span className="hidden w-28 text-xs text-muted-foreground xl:block">
                {lead.assigned_to ? namen?.[lead.assigned_to] ?? "" : ""}
              </span>
              <span className="hidden w-32 text-xs lg:block" suppressHydrationWarning>
                {lead.naechste_aktion_am && !stufe.abschluss ? `Rückruf ${rueckrufText(lead.naechste_aktion_am)}` : ""}
              </span>
              <span className="hidden w-24 text-right text-sm font-semibold md:block">
                {wert != null && (stufe.id === "auftrag" || stufe.id === "angebot") ? formatCurrency(wert) : ""}
              </span>
              <AlterAmpel lead={lead} className="w-28 justify-end" />
            </Link>
            <div className="w-32 shrink-0 text-right">
              {!stufe.abschluss && lead.telefon && <AnrufenKnopf leadId={lead.id} telefon={lead.telefon} zumLead />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function KeineLeads({ text }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border bg-card/60 px-4 py-12 text-center">
      <p className="text-base font-semibold">Keine Anfragen</p>
      <p className="mt-1 text-sm text-muted-foreground">{text ?? "Sobald neue Anfragen eingehen, erscheinen sie hier."}</p>
    </div>
  );
}
