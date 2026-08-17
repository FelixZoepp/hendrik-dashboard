"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { SlaBadge } from "./sla-badge";
import { LEAD_STATUS_CONFIG, formatCurrency } from "@/lib/lead-utils";
import { Phone, MapPin } from "lucide-react";
import type { Lead } from "@/lib/types/database";

interface LeadCardProps {
  lead: Lead;
  href: string;
}

export function LeadCard({ lead, href }: LeadCardProps) {
  const statusConfig = LEAD_STATUS_CONFIG[lead.status];

  return (
    <Link
      href={href}
      className="block rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50 group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">
            {lead.vorname} {lead.nachname}
          </p>
          {lead.ort && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="h-3 w-3 shrink-0" />
              {lead.plz && `${lead.plz} `}
              {lead.ort}
            </p>
          )}
        </div>
        <SlaBadge
          createdAt={lead.created_at}
          firstContactAt={lead.first_contact_at}
        />
      </div>

      {lead.anliegen && (
        <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
          {lead.anliegen}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium",
            statusConfig.color
          )}
        >
          {statusConfig.label}
        </span>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lead.auftragswert != null && (
            <span className="font-mono font-medium text-foreground">
              {formatCurrency(lead.auftragswert)}
            </span>
          )}
          {lead.telefon && (
            <Phone className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
      </div>
    </Link>
  );
}
