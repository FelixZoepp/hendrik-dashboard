import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { ladeKampagnenBericht } from "@/lib/kampagne/daten";
import {
  aktuellerMonat,
  leseZeitraum,
  monatPlus,
  monatsName,
  roiText,
  TAGE_OPTIONEN,
  zusammenfassung,
} from "@/lib/kampagne/logik";
import { KennzahlenRaster } from "@/components/kampagne/kennzahlen-raster";
import { KampagnenVerlauf } from "@/components/kampagne/kampagnen-verlauf";
import { ZeitraumWahl } from "@/components/kampagne/zeitraum-wahl";

export const metadata: Metadata = { title: "Kampagne" };
export const dynamic = "force-dynamic";

const fmtZeit = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function KampagnePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireKunde();
  const params = await searchParams;
  const now = new Date();
  const zeitraum = leseZeitraum(params, now);
  const bericht = await ladeKampagnenBericht(createAdminClient(), ctx.companyId, zeitraum);
  const k = bericht.kennzahlen;

  const dieserMonat = aktuellerMonat(now);
  const knoepfe = [
    { label: "Dieser Monat", href: "/kampagne", aktiv: zeitraum.monat === dieserMonat },
    ...TAGE_OPTIONEN.map((t) => ({ label: `${t} Tage`, href: `/kampagne?tage=${t}`, aktiv: zeitraum.tage === t })),
  ];
  const monate = Array.from({ length: 12 }, (_, i) => monatPlus(dieserMonat, -(i + 1))).map((m) => ({
    wert: m,
    label: monatsName(m),
  }));
  const berichtMonat = zeitraum.monat ?? dieserMonat;
  const roi = roiText(k.roi);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="fern-page-title">Deine Kampagne</h1>
          <p className="text-sm text-muted-foreground">
            {zeitraum.label} · {zeitraum.bereich}
          </p>
        </div>
        <ZeitraumWahl
          knoepfe={knoepfe}
          monate={monate}
          monatAktiv={zeitraum.monat && zeitraum.monat !== dieserMonat ? zeitraum.monat : null}
        />
      </div>

      <section className="fern-hero p-6 sm:p-8">
        <p className="text-xl font-semibold leading-snug sm:text-3xl">{zusammenfassung(zeitraum.label, k)}</p>
        {roi && <p className="mt-2 text-base text-white/85 sm:text-lg">{roi}</p>}
      </section>

      <KennzahlenRaster kennzahlen={k} />

      <section className="fern-card p-6">
        <h2 className="mb-4 text-base font-semibold">Verlauf</h2>
        <KampagnenVerlauf daten={bericht.verlauf} />
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={`/kampagne/bericht?monat=${berichtMonat}`}
          className="inline-flex items-center gap-2 self-start rounded-full bg-card px-4 py-2 text-sm font-medium shadow-sm hover:text-primary"
        >
          <FileText className="size-4" />
          Monatsbericht {monatsName(berichtMonat)} (als PDF speichern)
        </Link>
        {bericht.letzterAbgleich && (
          <p className="text-xs text-muted-foreground">
            Werbekosten zuletzt abgeglichen: {fmtZeit.format(new Date(bericht.letzterAbgleich))} Uhr
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Anfragen zählen aus deiner Lead-Liste (ohne selbst eingetragene und Empfehlungen). Termine, Aufträge und
        Umsatz stimmen, wenn du bei deinen Leads den Stand und bei gewonnenen Aufträgen den Auftragswert einträgst.
      </p>
    </div>
  );
}
