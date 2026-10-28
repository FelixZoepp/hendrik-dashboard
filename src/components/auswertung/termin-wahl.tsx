"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { rueckrufAusDatum, zeitpunktText } from "@/lib/crm/logik";
import { TERMIN_ARTEN, terminZeit, type TerminArt } from "@/lib/auswertung/logik";

const TAG = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit" });
const UHRZEITEN = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];

const CHIP =
  "min-h-11 rounded-2xl border-2 border-border bg-card px-3 py-2 text-sm font-semibold transition hover:border-primary/50 disabled:opacity-50";
const AN = "border-primary bg-primary text-primary-foreground hover:border-primary";

/**
 * Termin-Schnellwahl (Berliner Zeit): Art · Tag (heute … +6 Tage oder Datum) · Uhrzeit (Raster oder frei).
 * onWahl bekommt ISO-Zeitpunkt + Art.
 */
export function TerminWahl({
  onWahl,
  disabled,
  knopfText = "Termin speichern",
  standardArt = "vor_ort",
  className,
}: {
  onWahl: (iso: string, art: TerminArt) => void;
  disabled?: boolean;
  knopfText?: string;
  standardArt?: TerminArt;
  className?: string;
}) {
  const [jetzt] = useState(() => new Date());
  const [art, setArt] = useState<TerminArt>(standardArt);
  const [tag, setTag] = useState<number | "datum">(1);
  const [datum, setDatum] = useState("");
  const [uhrzeit, setUhrzeit] = useState("10:00");
  const [freieZeit, setFreieZeit] = useState(false);

  const tage = Array.from({ length: 7 }, (_, i) => {
    const d = terminZeit(i, "12:00", jetzt);
    const label = i === 0 ? "Heute" : i === 1 ? "Morgen" : d ? TAG.format(d) : `+${i}`;
    return { i, label };
  });

  const zeitpunkt =
    tag === "datum" ? (datum ? rueckrufAusDatum(datum, uhrzeit) : null) : terminZeit(tag, uhrzeit, jetzt);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Art des Termins">
        {TERMIN_ARTEN.map((a) => (
          <button key={a.value} type="button" disabled={disabled} className={cn(CHIP, art === a.value && AN)} onClick={() => setArt(a.value)}>
            {a.label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-semibold">Wann?</p>
        <div className="grid grid-cols-4 gap-2">
          {tage.map((t) => (
            <button key={t.i} type="button" disabled={disabled} className={cn(CHIP, tag === t.i && AN)} onClick={() => setTag(t.i)}>
              {t.label}
            </button>
          ))}
          <button type="button" disabled={disabled} className={cn(CHIP, tag === "datum" && AN)} onClick={() => setTag("datum")}>
            <CalendarDays className="mx-auto size-4" />
            <span className="sr-only">Anderes Datum</span>
          </button>
        </div>
        {tag === "datum" && (
          <Input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} className="h-12 w-auto rounded-2xl text-base" />
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-semibold">Uhrzeit</p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {UHRZEITEN.map((u) => (
            <button
              key={u}
              type="button"
              disabled={disabled}
              className={cn(CHIP, !freieZeit && uhrzeit === u && AN)}
              onClick={() => {
                setFreieZeit(false);
                setUhrzeit(u);
              }}
            >
              {u.replace(/^0/, "")}
            </button>
          ))}
          <button type="button" disabled={disabled} className={cn(CHIP, freieZeit && AN)} onClick={() => setFreieZeit(true)}>
            Andere
          </button>
        </div>
        {freieZeit && (
          <Input type="time" value={uhrzeit} onChange={(e) => setUhrzeit(e.target.value)} className="h-12 w-32 rounded-2xl text-base" />
        )}
      </div>

      <Button
        size="lg"
        className="h-12 w-full rounded-2xl text-base"
        disabled={disabled || !zeitpunkt}
        onClick={() => zeitpunkt && onWahl(zeitpunkt.toISOString(), art)}
      >
        {zeitpunkt ? `${knopfText}: ${zeitpunktText(zeitpunkt)}` : "Bitte Datum wählen"}
      </Button>
    </div>
  );
}
