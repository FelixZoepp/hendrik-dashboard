"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { AUSWAHL_KLASSE } from "@/components/zugaenge/stil";

export interface ZeitraumOption {
  label: string;
  href: string;
  aktiv: boolean;
}

/** 7/30/90 Tage + Dieser Monat als Knöpfe, ältere Monate als Auswahl. */
export function ZeitraumWahl({
  knoepfe,
  monate,
  monatAktiv,
}: {
  knoepfe: ZeitraumOption[];
  monate: Array<{ wert: string; label: string }>;
  monatAktiv: string | null;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap items-center gap-1 rounded-full bg-card p-1.5 shadow-[0_1px_2px_rgb(22_26_23/0.04),0_8px_24px_-12px_rgb(22_26_23/0.08)]">
        {knoepfe.map((k) => (
          <Link
            key={k.href}
            href={k.href}
            className={cn(
              "rounded-full px-4 py-2 text-sm transition-colors",
              k.aktiv ? "fern-btn-primary font-medium text-white" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {k.label}
          </Link>
        ))}
      </div>
      <label className="sr-only" htmlFor="kampagne-monat">
        Monat wählen
      </label>
      <select
        id="kampagne-monat"
        className={cn(AUSWAHL_KLASSE, "h-10 w-auto rounded-full px-4")}
        value={monatAktiv ?? ""}
        onChange={(e) => {
          if (e.target.value) router.push(`/kampagne?monat=${e.target.value}`);
        }}
      >
        <option value="">Monat wählen …</option>
        {monate.map((m) => (
          <option key={m.wert} value={m.wert}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
