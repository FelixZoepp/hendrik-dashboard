"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CalendarPlus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { terminLinkText } from "@/lib/kalender/logik";

/**
 * „Termin-Link senden“: kopiert einen kurzen Text mit dem eigenen Buchungslink in die Zwischenablage.
 * Es wird NICHTS automatisch verschickt – der Handwerker fügt den Text selbst in WhatsApp/SMS ein.
 */
export function TerminLinkKnopf({
  link,
  vorname,
  firmenName,
  className,
}: {
  link: string;
  vorname?: string | null;
  firmenName?: string | null;
  className?: string;
}) {
  const [kopiert, setKopiert] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(terminLinkText(vorname, link, firmenName));
          setKopiert(true);
          toast.success("Termin-Link kopiert – jetzt in WhatsApp oder SMS einfügen.");
          setTimeout(() => setKopiert(false), 2500);
        } catch {
          toast.error("Kopieren hat nicht geklappt.", { description: link });
        }
      }}
      className={cn(
        "inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-primary/30 bg-card px-5 text-base font-semibold text-primary transition hover:bg-primary/5 active:translate-y-px [&_svg]:size-5",
        className,
      )}
    >
      {kopiert ? <Check /> : <CalendarPlus />}
      {kopiert ? "Kopiert" : "Termin-Link senden (kopieren)"}
    </button>
  );
}
