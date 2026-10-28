"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/lead-utils";
import { ansichtStarten } from "@/lib/ansicht-aktionen";
import { dauerKurz, type Ampel } from "@/lib/auswertung/logik";

export interface KundenZeile {
  companyId: string;
  name: string;
  anfragen: number;
  speedMedian: number | null;
  erreichtQuote: number | null;
  showRate: number | null;
  abschlussquote: number | null;
  umsatz: number;
  ampel: { speed: Ampel; erreicht: Ampel; show: Ampel; abschluss: Ampel };
}

type Spalte = "name" | "anfragen" | "speedMedian" | "erreichtQuote" | "showRate" | "abschlussquote" | "umsatz";

const SPALTEN: { id: Spalte; label: string; aufsteigendBesser?: boolean }[] = [
  { id: "name", label: "Kunde" },
  { id: "anfragen", label: "Anfragen" },
  { id: "speedMedian", label: "Speed-to-Lead (Median)", aufsteigendBesser: true },
  { id: "erreichtQuote", label: "Erreicht" },
  { id: "showRate", label: "Show-Rate" },
  { id: "abschlussquote", label: "Abschluss" },
  { id: "umsatz", label: "Umsatz" },
];

const AMPEL_KLASSE: Record<Ampel, string> = {
  gruen: "bg-sla-gruen",
  gelb: "bg-sla-gelb",
  rot: "bg-sla-rot",
  grau: "bg-muted-foreground/30",
};
const AMPEL_TEXT: Record<Ampel, string> = { gruen: "gut", gelb: "mittel", rot: "schlecht", grau: "keine Daten" };

function Punkt({ a }: { a: Ampel }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", AMPEL_KLASSE[a])} title={AMPEL_TEXT[a]} aria-label={AMPEL_TEXT[a]} />;
}

const pct = (n: number | null) => (n == null ? "—" : `${n} %`);

/** Vergleich je Kunde mit Ampel, sortierbar per Klick auf die Spaltenüberschrift. */
export function KundenTabelle({ zeilen }: { zeilen: KundenZeile[] }) {
  const [sort, setSort] = useState<{ spalte: Spalte; ab: boolean }>({ spalte: "anfragen", ab: true });

  const sortiert = [...zeilen].sort((x, y) => {
    const a = x[sort.spalte];
    const b = y[sort.spalte];
    if (a == null && b == null) return 0;
    if (a == null) return 1; // ohne Daten immer unten
    if (b == null) return -1;
    const v = typeof a === "string" ? a.localeCompare(String(b)) : (a as number) - (b as number);
    return sort.ab ? -v : v;
  });

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            {SPALTEN.map((s) => (
              <th key={s.id} className={cn("py-2 font-medium", s.id !== "name" && "text-right")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() =>
                    setSort((alt) =>
                      alt.spalte === s.id ? { spalte: s.id, ab: !alt.ab } : { spalte: s.id, ab: s.id === "name" || s.aufsteigendBesser ? false : true },
                    )
                  }
                >
                  {s.label}
                  {sort.spalte === s.id && (sort.ab ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                </button>
              </th>
            ))}
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {sortiert.map((z) => (
            <tr key={z.companyId} className="border-t border-border/60">
              <td className="py-2.5 font-semibold">
                <Link href={`/kunden/${z.companyId}`} className="hover:text-primary hover:underline">
                  {z.name}
                </Link>
              </td>
              <td className="py-2.5 text-right tabular-nums">{z.anfragen}</td>
              <td className="py-2.5 text-right tabular-nums">
                <span className="inline-flex items-center gap-2">
                  {dauerKurz(z.speedMedian)} <Punkt a={z.ampel.speed} />
                </span>
              </td>
              <td className="py-2.5 text-right tabular-nums">
                <span className="inline-flex items-center gap-2">
                  {pct(z.erreichtQuote)} <Punkt a={z.ampel.erreicht} />
                </span>
              </td>
              <td className="py-2.5 text-right tabular-nums">
                <span className="inline-flex items-center gap-2">
                  {pct(z.showRate)} <Punkt a={z.ampel.show} />
                </span>
              </td>
              <td className="py-2.5 text-right tabular-nums">
                <span className="inline-flex items-center gap-2">
                  {pct(z.abschlussquote)} <Punkt a={z.ampel.abschluss} />
                </span>
              </td>
              <td className="py-2.5 text-right tabular-nums">{formatCurrency(z.umsatz)}</td>
              <td className="py-2.5 pl-3 text-right">
                <form action={ansichtStarten}>
                  <input type="hidden" name="company_id" value={z.companyId} />
                  <Button type="submit" size="sm" variant="secondary">
                    <Eye /> Als Kunde ansehen
                  </Button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
