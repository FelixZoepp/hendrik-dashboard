"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck, CalendarClock, CalendarPlus, CalendarX, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { rueckrufText, zeitpunktText } from "@/lib/crm/logik";
import {
  terminArtLabel,
  terminStatusInfo,
  wartetAufRueckmeldung,
  type ATermin,
  type TerminStatus,
} from "@/lib/auswertung/logik";
import { terminAnlegen, terminErgebnis } from "@/app/(client)/leads/termin-actions";
import { TerminWahl } from "./termin-wahl";

export type TerminZeile = ATermin;

function useAusfuehren() {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  async function ausfuehren<T>(fn: () => Promise<{ data: T | null; error: string | null }>, erfolg: string | ((d: T) => string)) {
    setLaeuft(true);
    try {
      const res = await fn();
      if (res.error || res.data == null) {
        toast.error(res.error ?? "Hat nicht geklappt");
        return null;
      }
      toast.success(typeof erfolg === "string" ? erfolg : erfolg(res.data));
      router.refresh();
      return res.data;
    } catch {
      toast.error("Hat nicht geklappt. Bitte nochmal versuchen.");
      return null;
    } finally {
      setLaeuft(false);
    }
  }
  return { ausfuehren, laeuft };
}

/**
 * „Wie war der Termin?“ — Stattgefunden / Nicht erschienen / Verschoben (+ Abgesagt).
 * Nach „Nicht erschienen“ wird gleich „Neuen Termin machen“ angeboten (= No-Show-Recovery).
 */
export function TerminRueckmeldung({
  termin,
  titel,
  className,
}: {
  termin: Pick<ATermin, "id" | "lead_id" | "beginn" | "art">;
  /** z. B. Name des Leads auf der Startseite */
  titel?: string;
  className?: string;
}) {
  const { ausfuehren, laeuft } = useAusfuehren();
  const [modus, setModus] = useState<"frage" | "verschieben" | "noshow" | "fertig">("frage");

  async function setze(status: Exclude<TerminStatus, "geplant">) {
    const d = await ausfuehren(
      () => terminErgebnis(termin.id, status),
      (r) =>
        status === "nicht_erschienen"
          ? r.rueckruf
            ? `Rückruf ${rueckrufText(r.rueckruf)} vorgemerkt`
            : "Als nicht erschienen vermerkt"
          : status === "stattgefunden"
            ? "Super – Termin hat stattgefunden"
            : "Gespeichert",
    );
    if (d) setModus(status === "nicht_erschienen" ? "noshow" : "fertig");
  }

  if (modus === "fertig") return null;

  return (
    <div className={cn("space-y-3 rounded-2xl border-2 border-primary/30 bg-card p-4", className)}>
      <div>
        {titel && <p className="text-base font-bold">{titel}</p>}
        <p className={cn(titel ? "text-sm text-muted-foreground" : "text-lg font-bold")} suppressHydrationWarning>
          {modus === "noshow"
            ? "Nicht erschienen – gleich neuen Termin machen?"
            : modus === "verschieben"
              ? "Neuer Termin"
              : `Wie war der Termin? (${terminArtLabel(termin.art)}, ${zeitpunktText(termin.beginn)})`}
        </p>
      </div>

      {modus === "frage" && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button size="lg" className="h-14 rounded-2xl text-base" disabled={laeuft} onClick={() => void setze("stattgefunden")}>
              <CalendarCheck className="size-5" /> Stattgefunden
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-14 rounded-2xl border-sla-rot/40 text-base"
              disabled={laeuft}
              onClick={() => void setze("nicht_erschienen")}
            >
              <CalendarX className="size-5" /> Nicht erschienen
            </Button>
            <Button size="lg" variant="outline" className="h-14 rounded-2xl text-base" disabled={laeuft} onClick={() => setModus("verschieben")}>
              <Repeat className="size-5" /> Verschoben
            </Button>
          </div>
          <button type="button" className="text-sm text-muted-foreground underline" disabled={laeuft} onClick={() => void setze("abgesagt")}>
            Termin wurde abgesagt
          </button>
        </>
      )}

      {(modus === "verschieben" || modus === "noshow") && (
        <>
          <TerminWahl
            disabled={laeuft}
            standardArt={termin.art}
            knopfText="Neuer Termin"
            onWahl={async (iso, art) => {
              const d = await ausfuehren(
                () => terminAnlegen(termin.lead_id, { beginn: iso, art, ersetztId: termin.id }),
                `Neuer Termin ${zeitpunktText(iso)} gespeichert`,
              );
              if (d) setModus("fertig");
            }}
          />
          <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setModus(modus === "noshow" ? "fertig" : "frage")}>
            {modus === "noshow" ? "Später – erst anrufen" : "Zurück"}
          </button>
        </>
      )}
    </div>
  );
}

/** Termine am Lead: Liste, Rückmeldung für vergangene, „Neuer Termin“ (verknüpft offene No-Shows automatisch). */
export function TermineBereich({
  leadId,
  termine,
  abgeschlossen,
  jetztIso,
}: {
  leadId: string;
  termine: TerminZeile[];
  abgeschlossen: boolean;
  jetztIso: string;
}) {
  const { ausfuehren, laeuft } = useAusfuehren();
  const [neu, setNeu] = useState(false);
  const jetzt = new Date(jetztIso);
  const wartend = termine.filter((t) => wartetAufRueckmeldung(t, jetzt));
  const ersetzt = new Set(termine.map((t) => t.ersetzt_termin_id).filter(Boolean));
  const offenerNoShow = termine.find((t) => t.status === "nicht_erschienen" && !ersetzt.has(t.id));
  const sortiert = [...termine].sort((a, b) => b.beginn.localeCompare(a.beginn));

  return (
    <div className="space-y-3">
      {wartend.map((t) => (
        <TerminRueckmeldung key={t.id} termin={t} />
      ))}

      {sortiert.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch kein Termin.</p>
      ) : (
        <ul className="divide-y rounded-2xl border">
          {sortiert.map((t) => {
            const info = terminStatusInfo(t.status);
            const vorbeiOffen = wartetAufRueckmeldung(t, jetzt);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <CalendarClock className="size-4 text-muted-foreground" />
                <span className="font-semibold" suppressHydrationWarning>
                  {zeitpunktText(t.beginn)}
                </span>
                <span className="text-sm text-muted-foreground">{terminArtLabel(t.art)}</span>
                <span className={cn("ml-auto rounded-md px-2 py-0.5 text-xs font-semibold", vorbeiOffen ? "bg-amber-100 text-amber-800" : info.farbe)}>
                  {vorbeiOffen ? "Wie war’s?" : info.label}
                </span>
                {t.ersetzt_termin_id && <span className="w-full text-xs text-muted-foreground">Neu vereinbart (ersetzt früheren Termin)</span>}
              </li>
            );
          })}
        </ul>
      )}

      {!abgeschlossen &&
        (neu ? (
          <div className="space-y-2 rounded-2xl border p-4">
            <p className="text-sm font-semibold">{offenerNoShow ? "Neuer Termin nach No-Show" : "Neuer Termin"}</p>
            <TerminWahl
              disabled={laeuft}
              onWahl={async (iso, art) => {
                const d = await ausfuehren(() => terminAnlegen(leadId, { beginn: iso, art }), `Termin ${zeitpunktText(iso)} gespeichert`);
                if (d) setNeu(false);
              }}
            />
            <Button variant="ghost" onClick={() => setNeu(false)}>
              Abbrechen
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="lg" className="h-12 w-full rounded-2xl" onClick={() => setNeu(true)}>
            <CalendarPlus /> {offenerNoShow ? "Neuen Termin machen (No-Show zurückholen)" : "Termin eintragen"}
          </Button>
        ))}
    </div>
  );
}
