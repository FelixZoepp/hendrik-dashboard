"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { SlaBadge } from "./sla-badge";
import { LEAD_STATUS_CONFIG, formatCurrency } from "@/lib/lead-utils";
import { Phone, Mail, MapPin } from "lucide-react";
import type { Lead } from "@/lib/types/database";

interface LeadListProps {
  leads: Lead[];
}

export function LeadList({ leads }: LeadListProps) {
  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 py-12 text-center">
        <p className="text-sm font-medium text-foreground">Keine Leads</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Sobald neue Anfragen eingehen, erscheinen sie hier.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y rounded-lg border bg-card">
      {leads.map((lead) => {
        const config = LEAD_STATUS_CONFIG[lead.status];
        return (
          <Link
            key={lead.id}
            href={`/leads/${lead.id}`}
            className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/50 sm:px-4"
          >
            {/* Name + Ort */}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {lead.vorname} {lead.nachname}
              </p>
              <div className="flex items-center gap-3 mt-0.5">
                {lead.ort && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {lead.ort}
                  </span>
                )}
                {lead.anliegen && (
                  <span className="text-xs text-muted-foreground truncate hidden sm:block max-w-48">
                    {lead.anliegen}
                  </span>
                )}
              </div>
            </div>

            {/* SLA */}
            <SlaBadge
              createdAt={lead.created_at}
              firstContactAt={lead.first_contact_at}
              className="hidden sm:inline-flex"
            />

            {/* Status */}
            <span
              className={cn(
                "hidden sm:inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
                config.color
              )}
            >
              {config.label}
            </span>

            {/* Wert */}
            {lead.auftragswert != null && (
              <span className="hidden lg:block text-xs font-mono font-medium whitespace-nowrap">
                {formatCurrency(lead.auftragswert)}
              </span>
            )}

            {/* Kontakt-Icons */}
            <div className="flex items-center gap-1.5 text-muted-foreground">
              {lead.telefon && <Phone className="h-3.5 w-3.5" />}
              {lead.email && <Mail className="h-3.5 w-3.5" />}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
