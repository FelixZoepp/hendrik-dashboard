"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getReaktionszeit } from "@/lib/lead-utils";
import { Timer } from "lucide-react";
import type { SlaAmpel } from "@/lib/types/database";

const AMPEL_STYLES: Record<SlaAmpel, string> = {
  gruen:
    "bg-sla-gruen/15 text-sla-gruen border-sla-gruen/30",
  gelb:
    "bg-sla-gelb/15 text-sla-gelb border-sla-gelb/30",
  rot:
    "bg-sla-rot/15 text-sla-rot border-sla-rot/30 animate-pulse",
};

interface SlaBadgeProps {
  createdAt: string;
  firstContactAt: string | null;
  className?: string;
}

export function SlaBadge({
  createdAt,
  firstContactAt,
  className,
}: SlaBadgeProps) {
  const [reaktion, setReaktion] = useState(() =>
    getReaktionszeit(createdAt, firstContactAt)
  );

  // Live-Countdown wenn noch kein Erstkontakt
  useEffect(() => {
    if (firstContactAt) return;

    const interval = setInterval(() => {
      setReaktion(getReaktionszeit(createdAt, null));
    }, 10_000); // alle 10 Sekunden aktualisieren

    return () => clearInterval(interval);
  }, [createdAt, firstContactAt]);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-mono font-semibold tabular-nums",
        AMPEL_STYLES[reaktion.ampel],
        className
      )}
    >
      <Timer className="h-3 w-3" />
      {reaktion.label}
      {firstContactAt && (
        <span className="text-[10px] font-normal opacity-70 ml-0.5">✓</span>
      )}
    </span>
  );
}
