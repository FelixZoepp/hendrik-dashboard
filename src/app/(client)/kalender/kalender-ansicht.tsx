"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck, CalendarPlus, Check, Copy, Link2, Mail, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AboLinks } from "@/lib/kalender/logik";
import { buchungslinkSpeichern, kalenderLinkErzeugen, type KalenderStatus } from "./actions";

const START: KalenderStatus = { fehler: null, meldung: null };

const GROSS =
  "inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl px-5 text-base font-semibold shadow-sm transition hover:brightness-110 active:translate-y-px [&_svg]:size-5";

interface Props {
  links: AboLinks | null;
  letzterAbruf: string | null;
  buchungslink: string;
}

export function KalenderAnsicht({ links, letzterAbruf, buchungslink }: Props) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [kopiert, setKopiert] = useState(false);
  const [bStatus, bAktion, bLaeuft] = useActionState(buchungslinkSpeichern, START);

  function linkErzeugen(neu: boolean) {
    if (neu && !window.confirm("Neuen Link erzeugen? Der alte Link funktioniert dann nicht mehr – du musst den Kalender neu verbinden.")) return;
    starte(async () => {
      const res = await kalenderLinkErzeugen();
      if (res.fehler) toast.error(res.fehler);
      else toast.success(neu ? "Neuer Link ist fertig – jetzt nochmal verbinden." : "Link ist fertig – jetzt Kalender wählen.");
      router.refresh();
    });
  }

  async function kopieren() {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.https);
      setKopiert(true);
      toast.success("Link kopiert");
      setTimeout(() => setKopiert(false), 2000);
    } catch {
      toast.error("Kopieren hat nicht geklappt – bitte den Link markieren und kopieren.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Kalender-Abo */}
      <section className="fern-card space-y-5 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <CalendarCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">Dein Kalender-Abo</h2>
            {links ? (
              letzterAbruf ? (
                <p className="text-sm font-semibold text-success">Verbunden · zuletzt abgeholt {letzterAbruf}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Noch nicht verbunden – wähle unten deinen Kalender.</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">Einmal einrichten, dann kommen neue Termine und Rückrufe von allein.</p>
            )}
          </div>
        </div>

        {!links ? (
          <Button size="lg" className="h-14 w-full rounded-2xl text-base" disabled={laeuft} onClick={() => linkErzeugen(false)}>
            <CalendarPlus className="size-5" />
            {laeuft ? "Wird erstellt…" : "Kalender-Link erstellen"}
          </Button>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <a href={links.google} target="_blank" rel="noopener noreferrer" className={`${GROSS} bg-primary text-primary-foreground`}>
                <CalendarPlus />
                Mit Google Kalender
              </a>
              <a href={links.apple} className={`${GROSS} bg-foreground text-background`}>
                <Smartphone />
                Mit Apple / iPhone
              </a>
              <a href={links.outlook} target="_blank" rel="noopener noreferrer" className={`${GROSS} bg-[#0f6cbd] text-white`}>
                <Mail />
                Mit Outlook
              </a>
            </div>

            <ol className="space-y-2">
              {[
                "Knopf für deinen Kalender antippen.",
                "„Abonnieren“ bzw. „Hinzufügen“ bestätigen.",
                "Fertig – neue Termine und Rückrufe kommen von allein (Google braucht manchmal ein paar Stunden).",
              ].map((text, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{i + 1}</span>
                  <span className="pt-0.5 text-base">{text}</span>
                </li>
              ))}
            </ol>

            <div className="space-y-1.5">
              <Label htmlFor="abo-link" className="text-sm text-muted-foreground">
                Anderer Kalender? Diesen Link als „Kalender-Abo“ / „Kalender aus dem Internet“ einfügen:
              </Label>
              <div className="flex gap-2">
                <Input id="abo-link" readOnly value={links.https} className="h-12 bg-background font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" variant="secondary" className="h-12 rounded-xl px-4" onClick={kopieren}>
                  {kopiert ? <Check /> : <Copy />}
                  {kopiert ? "Kopiert" : "Kopieren"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Den Link nicht weitergeben – wer ihn hat, sieht deine Termine.</p>
            </div>

            <div className="border-t pt-4">
              <Button type="button" variant="outline" className="h-11 rounded-full" disabled={laeuft} onClick={() => linkErzeugen(true)}>
                <RefreshCw className="size-4" />
                {laeuft ? "Wird erzeugt…" : "Neuen Link erzeugen"}
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">Der alte Link funktioniert danach nicht mehr.</p>
            </div>
          </>
        )}
      </section>

      {/* Eigener Buchungslink */}
      <section className="fern-card space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground">
            <Link2 className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">Eigener Buchungslink</h2>
            <p className="text-sm text-muted-foreground">
              Optional: Calendly oder Google-Terminbuchung. Erscheint bei jeder Anfrage als Knopf „Termin-Link senden“ zum Kopieren.
            </p>
          </div>
        </div>
        <form action={bAktion} className="space-y-3">
          <Label htmlFor="buchungslink" className="sr-only">
            Buchungslink
          </Label>
          <Input
            id="buchungslink"
            name="buchungslink"
            type="url"
            inputMode="url"
            defaultValue={buchungslink}
            placeholder="https://calendly.com/dein-name"
            className="h-12 text-base"
          />
          {bStatus.fehler && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{bStatus.fehler}</p>}
          {bStatus.meldung && <p className="rounded-xl bg-success/10 px-3 py-2 text-sm text-success">{bStatus.meldung}</p>}
          <Button type="submit" size="lg" className="h-12 rounded-2xl" disabled={bLaeuft}>
            {bLaeuft ? "Wird gespeichert…" : "Speichern"}
          </Button>
        </form>
      </section>
    </div>
  );
}
