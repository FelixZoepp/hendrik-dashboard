"use client";

import { useRouter } from "next/navigation";
import { MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { telLink, waLink } from "@/lib/crm/logik";
import { kontaktProtokollieren } from "@/app/(client)/leads/actions";

interface KnopfProps {
  leadId: string;
  telefon: string | null;
  className?: string;
  /** groß = Detailseite, klein = Karte/Liste */
  groesse?: "gross" | "klein";
  /** Nach dem Antippen (z. B. Detailseite öffnen / Ergebnis abfragen) */
  nachher?: () => void;
  /** Nach dem Antippen zur Detailseite mit Ergebnis-Abfrage springen */
  zumLead?: boolean;
}

const GROSS = "h-14 flex-1 rounded-2xl px-5 text-base font-semibold gap-2.5 [&_svg]:size-5";
const KLEIN = "h-10 rounded-full px-4 text-sm font-semibold gap-1.5 [&_svg]:size-4";

/** Großer „Anrufen“-Knopf: öffnet tel:, protokolliert Anruf + Erstkontakt im Hintergrund. */
export function AnrufenKnopf({ leadId, telefon, className, groesse = "klein", nachher, zumLead }: KnopfProps) {
  const router = useRouter();
  const href = telLink(telefon);
  if (!href) {
    return (
      <span className={cn("inline-flex items-center justify-center text-xs text-muted-foreground", className)}>
        Keine Nummer
      </span>
    );
  }
  return (
    <a
      href={href}
      onClick={(e) => {
        e.stopPropagation();
        void kontaktProtokollieren(leadId, "anruf").then(() => router.refresh());
        nachher?.();
        if (zumLead) router.push(`/leads/${leadId}?anruf=1`);
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-success text-success-foreground shadow-sm transition hover:brightness-110 active:translate-y-px",
        groesse === "gross" ? GROSS : KLEIN,
        className,
      )}
    >
      <Phone />
      Anrufen
    </a>
  );
}

/** „WhatsApp“: öffnet wa.me mit kurzem Gruß (der Nutzer schickt selbst ab), protokolliert. */
export function WhatsAppKnopf({
  leadId,
  telefon,
  firmenName,
  vorname,
  className,
  groesse = "klein",
  nachher,
}: KnopfProps & { firmenName: string; vorname?: string | null }) {
  const router = useRouter();
  const href = waLink(telefon, firmenName, vorname);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        void kontaktProtokollieren(leadId, "whatsapp").then(() => router.refresh());
        nachher?.();
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-[#25D366] text-[#05361b] shadow-sm transition hover:brightness-105 active:translate-y-px",
        groesse === "gross" ? GROSS : KLEIN,
        className,
      )}
    >
      <MessageCircle />
      WhatsApp
    </a>
  );
}
