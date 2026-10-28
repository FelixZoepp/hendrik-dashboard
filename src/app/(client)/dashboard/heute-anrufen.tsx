"use client";

import Link from "next/link";
import { PhoneMissed } from "lucide-react";
import { cn } from "@/lib/utils";
import { rueckrufText, type AnrufGrund } from "@/lib/crm/logik";
import { AlterAmpel } from "@/components/crm/alter-ampel";
import { AnrufenKnopf } from "@/components/crm/kontakt-knoepfe";
import type { LeadStatus } from "@/lib/types/database";

export interface AnrufZeile {
  id: string;
  vorname: string;
  nachname: string;
  ort: string | null;
  anliegen: string | null;
  telefon: string | null;
  status: LeadStatus;
  created_at: string;
  first_contact_at: string | null;
  naechste_aktion_am: string | null;
  kontakt_versuche: number | null;
}

/** Eine Zeile in „Heute anrufen“: wer, warum, großer Anrufen-Knopf. */
export function HeuteAnrufenZeile({ lead }: { lead: AnrufZeile & { grund: AnrufGrund } }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <Link href={`/leads/${lead.id}`} className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold">
          {lead.vorname} {lead.nachname}
          {lead.ort && <span className="font-normal text-muted-foreground"> · {lead.ort}</span>}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          {lead.grund === "neu" ? (
            <>
              <span className="font-semibold text-primary">Neue Anfrage</span>
              <AlterAmpel lead={lead} />
            </>
          ) : (
            <span
              className={cn("font-semibold", lead.grund === "ueberfaellig" ? "text-sla-rot" : "text-foreground")}
              suppressHydrationWarning
            >
              {lead.grund === "ueberfaellig" ? "Überfällig" : "Rückruf"} {lead.naechste_aktion_am && rueckrufText(lead.naechste_aktion_am)}
            </span>
          )}
          {(lead.kontakt_versuche ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <PhoneMissed className="size-3" />
              {lead.kontakt_versuche}× nicht erreicht
            </span>
          )}
        </p>
        {lead.anliegen && <p className="truncate text-sm text-muted-foreground">{lead.anliegen}</p>}
      </Link>
      <AnrufenKnopf leadId={lead.id} telefon={lead.telefon} zumLead className="h-12 px-5" />
    </li>
  );
}
