"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { A_ZEITRAEUME, type AZeitraum } from "@/lib/auswertung/logik";

const AUSWAHL =
  "h-11 min-w-0 flex-1 rounded-full border border-input bg-card px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-none";

function url(pfad: string, p: { zeitraum: string; quelle?: string; kampagne?: string }) {
  const q = new URLSearchParams();
  q.set("zeitraum", p.zeitraum);
  if (p.quelle && p.quelle !== "alle") q.set("quelle", p.quelle);
  if (p.kampagne && p.kampagne !== "alle") q.set("kampagne", p.kampagne);
  return `${pfad}?${q.toString()}`;
}

/** Zeitraum (Knöpfe) + Quelle/Kampagne (Auswahl) — alles in der URL, damit die Seite serverseitig rechnet. */
export function FilterLeiste({
  pfad,
  zeitraum,
  quelle,
  kampagne,
  quellen,
  kampagnen,
}: {
  pfad: string;
  zeitraum: AZeitraum;
  quelle: string;
  kampagne: string;
  quellen: { value: string; label: string }[];
  kampagnen: { value: string; label: string }[];
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <nav className="flex flex-wrap gap-1.5" aria-label="Zeitraum">
        {A_ZEITRAEUME.map((z) => (
          <Link
            key={z.value}
            href={url(pfad, { zeitraum: z.value, quelle, kampagne })}
            scroll={false}
            className={cn(
              "rounded-full border-2 px-4 py-2 text-sm font-semibold",
              zeitraum === z.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
            )}
          >
            {z.label}
          </Link>
        ))}
      </nav>
      {(quellen.length > 1 || kampagnen.length > 1) && (
        <div className="flex gap-2">
          {quellen.length > 1 && (
            <select
              aria-label="Quelle"
              className={AUSWAHL}
              value={quelle}
              onChange={(e) => router.push(url(pfad, { zeitraum, quelle: e.target.value, kampagne }), { scroll: false })}
            >
              <option value="alle">Alle Quellen</option>
              {quellen.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
          )}
          {kampagnen.length > 1 && (
            <select
              aria-label="Kampagne"
              className={AUSWAHL}
              value={kampagne}
              onChange={(e) => router.push(url(pfad, { zeitraum, quelle, kampagne: e.target.value }), { scroll: false })}
            >
              <option value="alle">Alle Kampagnen</option>
              {kampagnen.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
