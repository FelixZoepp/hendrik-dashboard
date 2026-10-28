"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  VERLUST_GRUENDE,
  brauchtAngabe,
  leseEuro,
  pruefeStufenWechsel,
  stufeVon,
  stufenInfo,
  type Stufe,
  type StufenWechselEingabe,
} from "@/lib/crm/logik";
import { stufeSetzen } from "@/app/(client)/leads/actions";
import { TerminWahl } from "@/components/auswertung/termin-wahl";
import type { LeadStatus, VerlustGrund } from "@/lib/types/database";

export interface WechselLead {
  id: string;
  status: LeadStatus;
  angebotswert: number | null;
  auftragswert: number | null;
}

interface Offen {
  lead: WechselLead;
  stufe: Stufe;
  fertig?: (ok: boolean) => void;
}

/**
 * Stufenwechsel mit Pflichtangaben:
 *   Termin vor Ort → Datum/Uhrzeit (Schnellwahl, darf offen bleiben) ·
 *   Angebot raus → Angebotswert (optional) · Auftrag → Auftragswert (Pflicht) · Verloren → Grund
 * Andere Stufen werden sofort gespeichert.
 */
export function useStufenWechsel() {
  const router = useRouter();
  const [offen, setOffen] = useState<Offen | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function speichern(lead: WechselLead, e: StufenWechselEingabe): Promise<boolean> {
    const fehler = pruefeStufenWechsel(e);
    if (fehler) {
      toast.error(fehler);
      return false;
    }
    setLaeuft(true);
    try {
      const res = await stufeSetzen(lead.id, e);
      if (res.error) {
        toast.error(res.error);
        return false;
      }
      toast.success(
        e.stufe === "termin" && e.termin_beginn && stufeVon(lead.status) === "termin"
          ? "Termin gespeichert"
          : `Verschoben nach „${stufenInfo(e.stufe).label}“`,
      );
      router.refresh();
      return true;
    } catch {
      toast.error("Hat nicht geklappt. Bitte nochmal versuchen.");
      return false;
    } finally {
      setLaeuft(false);
    }
  }

  /** Startet den Wechsel; fertig(true) nach dem Speichern, fertig(false) bei Abbruch/Fehler. */
  async function starte(lead: WechselLead, stufe: Stufe, fertig?: (ok: boolean) => void) {
    if (stufeVon(lead.status) === stufe && stufe !== "angebot" && stufe !== "auftrag" && stufe !== "termin") {
      fertig?.(false);
      return;
    }
    if (brauchtAngabe(stufe)) {
      setOffen({ lead, stufe, fertig });
      return;
    }
    const ok = await speichern(lead, { stufe });
    fertig?.(ok);
  }

  function schliessen(ok: boolean) {
    offen?.fertig?.(ok);
    setOffen(null);
  }

  const dialog = (
    <StufenDialog
      key={offen ? `${offen.lead.id}-${offen.stufe}` : "zu"}
      offen={offen}
      laeuft={laeuft}
      onAbbruch={() => schliessen(false)}
      onSpeichern={async (e) => {
        if (!offen) return;
        const ok = await speichern(offen.lead, e);
        if (ok) schliessen(true);
      }}
    />
  );

  return { starte, dialog, laeuft };
}

function StufenDialog({
  offen,
  laeuft,
  onAbbruch,
  onSpeichern,
}: {
  offen: Offen | null;
  laeuft: boolean;
  onAbbruch: () => void;
  onSpeichern: (e: StufenWechselEingabe) => void;
}) {
  const stufe = offen?.stufe;
  const [betrag, setBetrag] = useState(() => {
    const w = stufe === "auftrag" ? offen?.lead.auftragswert ?? offen?.lead.angebotswert : offen?.lead.angebotswert;
    return w != null ? String(w).replace(".", ",") : "";
  });
  const [grund, setGrund] = useState<VerlustGrund | null>(null);
  const [notiz, setNotiz] = useState("");

  function absenden() {
    if (!stufe) return;
    if (stufe === "angebot") onSpeichern({ stufe, angebotswert: leseEuro(betrag) });
    else if (stufe === "auftrag") onSpeichern({ stufe, auftragswert: leseEuro(betrag) });
    else if (stufe === "verloren") onSpeichern({ stufe, verlust_grund: grund, verlust_notiz: notiz });
  }

  const titel =
    stufe === "termin"
      ? "Termin vor Ort"
      : stufe === "angebot"
        ? "Angebot raus"
        : stufe === "auftrag"
          ? "Auftrag bekommen ✅"
          : "Leider verloren ❌";

  return (
    <Dialog open={!!offen} onOpenChange={(o) => !o && onAbbruch()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">{titel}</DialogTitle>
          <DialogDescription>
            {stufe === "termin" && "Wann ist der Termin? Danach fragen wir dich kurz, wie er gelaufen ist."}
            {stufe === "angebot" && "Wie hoch ist das Angebot? (Kann leer bleiben)"}
            {stufe === "auftrag" && "Wie viel ist der Auftrag wert? Das brauchen wir für deinen Umsatz."}
            {stufe === "verloren" && "Woran lag es? Einfach antippen."}
          </DialogDescription>
        </DialogHeader>

        {stufe === "termin" && (
          <TerminWahl
            className="py-2"
            disabled={laeuft}
            onWahl={(iso, art) => onSpeichern({ stufe, termin_beginn: iso, termin_art: art })}
          />
        )}

        {(stufe === "angebot" || stufe === "auftrag") && (
          <form
            className="py-2"
            onSubmit={(e) => {
              e.preventDefault();
              absenden();
            }}
          >
            <label className="sr-only" htmlFor="stufe-betrag">Betrag in Euro</label>
            <div className="relative">
              <Input
                id="stufe-betrag"
                inputMode="decimal"
                autoFocus
                placeholder="z. B. 4.500"
                value={betrag}
                onChange={(e) => setBetrag(e.target.value)}
                className="h-14 rounded-2xl pr-12 text-2xl font-semibold"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xl text-muted-foreground">€</span>
            </div>
          </form>
        )}

        {stufe === "verloren" && (
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-2">
              {VERLUST_GRUENDE.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGrund(g.value)}
                  className={cn(
                    "min-h-12 rounded-2xl border-2 px-3 py-2 text-sm font-semibold transition",
                    grund === g.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:border-primary/50",
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {grund === "sonstiges" && (
              <Textarea
                autoFocus
                placeholder="Kurz: Was war los?"
                value={notiz}
                onChange={(e) => setNotiz(e.target.value)}
                rows={2}
                className="text-base"
              />
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="lg" onClick={onAbbruch} disabled={laeuft}>
            Abbrechen
          </Button>
          {stufe === "termin" ? (
            offen && stufeVon(offen.lead.status) !== "termin" && (
              <Button variant="ghost" size="lg" onClick={() => onSpeichern({ stufe })} disabled={laeuft}>
                Datum steht noch nicht fest
              </Button>
            )
          ) : (
            <Button size="lg" onClick={absenden} disabled={laeuft || (stufe === "verloren" && !grund)}>
              {laeuft ? "Speichert…" : "Speichern"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
