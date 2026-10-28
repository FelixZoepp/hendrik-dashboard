"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { berlinTeile, rueckrufAusDatum, rueckrufZeit, type RueckrufWahl } from "@/lib/crm/logik";

const UHR = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

function heuteIso(): string {
  const b = berlinTeile(new Date());
  return `${b.y}-${String(b.m).padStart(2, "0")}-${String(b.d).padStart(2, "0")}`;
}

/** Schnellwahl „heute später / morgen 9 Uhr / in 2 Tagen / Datum“ (Berliner Zeit). */
export function RueckrufWahl({
  onWahl,
  disabled,
  className,
}: {
  onWahl: (iso: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [jetzt] = useState(() => new Date());
  const [datumOffen, setDatumOffen] = useState(false);
  const [datum, setDatum] = useState("");
  const [uhrzeit, setUhrzeit] = useState("09:00");

  const optionen: { wahl: RueckrufWahl; label: string }[] = [];
  const spaeter = rueckrufZeit("heute_spaeter", jetzt);
  if (spaeter) optionen.push({ wahl: "heute_spaeter", label: `Heute ${UHR.format(spaeter)}` });
  optionen.push({ wahl: "morgen_9", label: "Morgen 9 Uhr" }, { wahl: "in_2_tagen", label: "In 2 Tagen" });

  const knopf =
    "min-h-12 rounded-2xl border-2 border-border bg-card px-3 py-2 text-sm font-semibold transition hover:border-primary/50 disabled:opacity-50";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {optionen.map((o) => (
          <button
            key={o.wahl}
            type="button"
            disabled={disabled}
            className={knopf}
            onClick={() => {
              const t = rueckrufZeit(o.wahl);
              if (t) onWahl(t.toISOString());
            }}
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          className={cn(knopf, datumOffen && "border-primary")}
          onClick={() => setDatumOffen((v) => !v)}
        >
          Datum wählen
        </button>
      </div>
      {datumOffen && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            min={heuteIso()}
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
            className="h-12 w-auto rounded-2xl text-base"
          />
          <Input
            type="time"
            value={uhrzeit}
            onChange={(e) => setUhrzeit(e.target.value)}
            className="h-12 w-28 rounded-2xl text-base"
          />
          <Button
            size="lg"
            disabled={disabled || !datum}
            onClick={() => {
              const t = rueckrufAusDatum(datum, uhrzeit || "09:00");
              if (t) onWahl(t.toISOString());
            }}
          >
            Übernehmen
          </Button>
        </div>
      )}
    </div>
  );
}
