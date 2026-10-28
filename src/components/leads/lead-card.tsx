"use client";

import Link from "next/link";
import { CalendarClock, MapPin, PhoneMissed } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, quelleLabel } from "@/lib/lead-utils";
import { rueckrufText, statusHinweis, stufeVon, stufenInfo, verlustGrundLabel } from "@/lib/crm/logik";
import { AlterAmpel } from "@/components/crm/alter-ampel";
import { AnrufenKnopf } from "@/components/crm/kontakt-knoepfe";
import type { Lead } from "@/lib/types/database";

interface LeadCardProps {
  lead: Lead;
  href: string;
  /** Stufen-Abzeichen zeigen (Liste/Handy), im Board überflüssig */
  mitStufe?: boolean;
  /** Anrufen-Knopf ausblenden (z. B. Drag-Vorschau) */
  ohneKnopf?: boolean;
  zustaendig?: string | null;
}

/** Karte: Name, Ort, Anliegen kurz, Alter + Ampel, Anrufen. */
export function LeadCard({ lead, href, mitStufe, ohneKnopf, zustaendig }: LeadCardProps) {
  const stufe = stufenInfo(stufeVon(lead.status));
  const hinweis = statusHinweis(lead.status);
  const grund = verlustGrundLabel(lead.verlust_grund);
  const versuche = lead.kontakt_versuche ?? 0;

  return (
    <div className="fern-card p-4 transition-colors hover:bg-accent/40">
      <Link href={href} className="block">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-base font-semibold">
            {lead.vorname} {lead.nachname}
          </p>
          <AlterAmpel lead={lead} className="shrink-0 pt-0.5" />
        </div>
        {(lead.ort || lead.plz) && (
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            {lead.plz && `${lead.plz} `}
            {lead.ort}
          </p>
        )}
        {lead.anliegen && <p className="mt-2 line-clamp-2 text-sm text-foreground/80">{lead.anliegen}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          {mitStufe && (
            <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", stufe.farbe)}>{stufe.label}</span>
          )}
          {hinweis && stufe.id === "verloren" && !grund && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">{hinweis}</span>
          )}
          {grund && <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">{grund}</span>}
          {versuche > 0 && !stufe.abschluss && (
            <span className="inline-flex items-center gap-1 rounded-md bg-orange-100 px-1.5 py-0.5 text-orange-800">
              <PhoneMissed className="size-3" />
              {versuche}× nicht erreicht
            </span>
          )}
          {lead.naechste_aktion_am && !stufe.abschluss && (
            <span className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-accent-foreground" suppressHydrationWarning>
              <CalendarClock className="size-3" />
              {rueckrufText(lead.naechste_aktion_am)}
            </span>
          )}
          {lead.auftragswert != null && stufe.id === "auftrag" && (
            <span className="font-semibold text-success">{formatCurrency(lead.auftragswert)}</span>
          )}
          {lead.angebotswert != null && stufe.id === "angebot" && (
            <span className="font-semibold">{formatCurrency(lead.angebotswert)}</span>
          )}
          <span className="text-muted-foreground">{quelleLabel(lead.quelle)}</span>
          {zustaendig && <span className="text-muted-foreground">· {zustaendig}</span>}
        </div>
      </Link>
      {!ohneKnopf && !stufe.abschluss && lead.telefon && (
        <div className="mt-3" onPointerDown={(e) => e.stopPropagation()}>
          <AnrufenKnopf leadId={lead.id} telefon={lead.telefon} zumLead className="w-full" />
        </div>
      )}
    </div>
  );
}
