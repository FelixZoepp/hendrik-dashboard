"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { alterText, speedAmpel } from "@/lib/crm/logik";
import type { LeadStatus, SlaAmpel } from "@/lib/types/database";

const AMPEL: Record<SlaAmpel, { punkt: string; text: string; titel: string }> = {
  gruen: { punkt: "bg-sla-gruen", text: "text-sla-gruen", titel: "Schnell anrufen – noch im grünen Bereich" },
  gelb: { punkt: "bg-sla-gelb", text: "text-sla-gelb", titel: "Wartet schon über 15 Minuten" },
  rot: { punkt: "bg-sla-rot animate-pulse", text: "text-sla-rot", titel: "Wartet über eine Stunde – jetzt anrufen!" },
};

/** Alter („vor 12 Min.“) + Speed-to-Lead-Ampel; zählt jede halbe Minute mit. */
export function AlterAmpel({
  lead,
  className,
}: {
  lead: { status: LeadStatus; created_at: string; first_contact_at: string | null };
  className?: string;
}) {
  const [jetzt, setJetzt] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setJetzt(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const ampel = speedAmpel(lead, jetzt);
  const a = ampel ? AMPEL[ampel] : null;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium tabular-nums", a ? a.text : "text-muted-foreground", className)}
      title={a?.titel}
      suppressHydrationWarning
    >
      {a && <span className={cn("size-2.5 rounded-full", a.punkt)} aria-hidden />}
      {alterText(lead.created_at, jetzt)}
    </span>
  );
}
