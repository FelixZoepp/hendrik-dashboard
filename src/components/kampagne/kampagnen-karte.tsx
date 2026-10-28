import Link from "next/link";
import { ArrowRight, Megaphone } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { ladeKampagnenBericht } from "@/lib/kampagne/daten";
import { euro, freierZeitraum } from "@/lib/kampagne/logik";

/**
 * Kampagnen-Kurzübersicht fürs Kunden-Dashboard (Server-Komponente).
 * Aufrufer übergibt die geprüfte Firma: <KampagnenKarte companyId={ctx.companyId} von={…} bis={…} />
 * `bis` ist exklusiv (z. B. jetzt oder 1. des Folgemonats).
 */
export async function KampagnenKarte({
  companyId,
  von,
  bis,
  titel = "Deine Kampagne",
}: {
  companyId: string;
  von: Date | string;
  bis: Date | string;
  titel?: string;
}) {
  const zeitraum = freierZeitraum(new Date(von), new Date(bis));
  let bericht: Awaited<ReturnType<typeof ladeKampagnenBericht>> | null = null;
  try {
    bericht = await ladeKampagnenBericht(createAdminClient(), companyId, zeitraum);
  } catch {
    bericht = null;
  }
  const k = bericht?.kennzahlen;

  const zahlen = [
    { label: "Anfragen", wert: k ? String(k.leads) : "—" },
    { label: "Kosten je Anfrage", wert: k?.kostenJeLead != null ? euro(k.kostenJeLead) : "—" },
    {
      label: "Für 1 € Werbung",
      wert: k?.roi != null ? `${euro(k.roi, { cent: true })} Umsatz` : "—",
    },
  ];

  return (
    <section className="fern-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Megaphone className="size-4 text-primary" />
          {titel}
        </h2>
        <span className="text-xs text-muted-foreground">{zeitraum.bereich}</span>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {zahlen.map((z) => (
          <div key={z.label}>
            <dt className="text-xs text-muted-foreground">{z.label}</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{z.wert}</dd>
          </div>
        ))}
      </dl>
      <Link
        href="/kampagne"
        className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        Alle Zahlen zur Kampagne
        <ArrowRight className="size-3.5" />
      </Link>
    </section>
  );
}
