import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { ladeKampagnenBericht } from "@/lib/kampagne/daten";
import {
  aktuellerMonat,
  euro,
  istMonat,
  monatPlus,
  monatsName,
  monatsZeitraum,
  roiText,
  zusammenfassung,
} from "@/lib/kampagne/logik";
import { KennzahlenRaster } from "@/components/kampagne/kennzahlen-raster";
import { DruckenKnopf } from "@/components/kampagne/drucken-knopf";

export const metadata: Metadata = { title: "Monatsbericht" };
export const dynamic = "force-dynamic";

const fmtErstellt = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const PLATTFORM: Record<string, string> = { meta: "Meta", google: "Google", manuell: "—" };

/**
 * Monatsbericht /kampagne/bericht?monat=YYYY-MM — eigene Route-Gruppe ohne App-Rahmen,
 * damit der Browser-Druck („Als PDF speichern“) nur den Bericht über mehrere Seiten druckt.
 * Kein automatischer Versand.
 */
export default async function KampagnenBerichtPage({
  searchParams,
}: {
  searchParams: Promise<{ monat?: string }>;
}) {
  const ctx = await requireKunde();
  const { monat: roh } = await searchParams;
  const now = new Date();
  const dieserMonat = aktuellerMonat(now);
  const monat = istMonat(roh) && roh <= dieserMonat ? roh : dieserMonat;
  const zeitraum = monatsZeitraum(monat, now);
  const bericht = await ladeKampagnenBericht(createAdminClient(), ctx.companyId, zeitraum);
  const k = bericht.kennzahlen;
  const roi = roiText(k.roi);
  const vor = monatPlus(monat, -1);
  const nach = monatPlus(monat, 1);
  const laufend = monat === dieserMonat;

  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      <style>{`@page { size: A4; margin: 14mm; } @media print { html, body { background: #fff !important; } }`}</style>

      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 pt-6 print:hidden">
        <Link href="/kampagne" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Zurück zur Kampagne
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/kampagne/bericht?monat=${vor}`}
            className="inline-flex size-9 items-center justify-center rounded-full bg-card hover:text-primary"
            aria-label={`Bericht ${monatsName(vor)}`}
          >
            <ChevronLeft className="size-4" />
          </Link>
          {nach <= dieserMonat && (
            <Link
              href={`/kampagne/bericht?monat=${nach}`}
              className="inline-flex size-9 items-center justify-center rounded-full bg-card hover:text-primary"
              aria-label={`Bericht ${monatsName(nach)}`}
            >
              <ChevronRight className="size-4" />
            </Link>
          )}
          <DruckenKnopf />
        </div>
      </div>

      <article className="mx-auto max-w-4xl space-y-6 px-4 py-6 print:max-w-none print:space-y-5 print:p-0">
        <header className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-4">
          <div>
            <p className="text-sm font-medium text-primary">Hoffmann Solutions · Monatsbericht</p>
            <h1 className="text-3xl font-semibold tracking-tight">{monatsName(monat)}</h1>
            <p className="text-sm text-muted-foreground">
              {ctx.company.name} · {zeitraum.bereich}
              {laufend ? " (laufender Monat)" : ""}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Erstellt am {fmtErstellt.format(now)}</p>
        </header>

        <section className="rounded-3xl bg-accent p-6 print:break-inside-avoid print:border print:border-border print:bg-white">
          <p className="text-xl font-semibold leading-snug sm:text-2xl">
            {zusammenfassung(laufend ? "Diesen Monat" : monatsName(monat), k)}
          </p>
          {roi && <p className="mt-1 text-base text-muted-foreground">{roi}</p>}
        </section>

        <KennzahlenRaster kennzahlen={k} className="print:grid-cols-4 print:gap-2" />

        <section className="fern-card p-6 print:break-inside-avoid print:border print:border-border print:shadow-none">
          <h2 className="mb-3 text-base font-semibold">Verlauf je Woche</h2>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">Woche</th>
                <th className="py-2 text-right font-medium">Anfragen</th>
                <th className="py-2 text-right font-medium">Werbebudget</th>
              </tr>
            </thead>
            <tbody>
              {bericht.verlauf.map((w) => (
                <tr key={w.woche} className="border-b border-border/60 last:border-0">
                  <td className="py-2">{w.label}</td>
                  <td className="py-2 text-right">{w.leads}</td>
                  <td className="py-2 text-right">{euro(w.ausgaben, { cent: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="fern-card p-6 print:break-inside-avoid print:border print:border-border print:shadow-none">
          <h2 className="mb-3 text-base font-semibold">Kampagnen</h2>
          {bericht.kampagnen.length === 0 ? (
            <p className="text-sm text-muted-foreground">In diesem Monat sind keine Werbekosten erfasst.</p>
          ) : (
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 font-medium">Kampagne</th>
                  <th className="py-2 font-medium">Kanal</th>
                  <th className="py-2 text-right font-medium">Budget</th>
                  <th className="py-2 text-right font-medium">Anfragen laut Werbekonto</th>
                </tr>
              </thead>
              <tbody>
                {bericht.kampagnen.map((c) => (
                  <tr key={`${c.plattform}-${c.kampagneId ?? "manuell"}`} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-2">{c.name}</td>
                    <td className="py-2 pr-2">{PLATTFORM[c.plattform] ?? c.plattform}</td>
                    <td className="py-2 text-right">{euro(c.ausgaben, { cent: false })}</td>
                    <td className="py-2 text-right">{c.plattform === "manuell" ? "—" : c.leadsPlattform}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <footer className="text-xs text-muted-foreground">
          Anfragen zählen aus der Lead-Liste in der Hoffmann Solutions Cloud (ohne selbst eingetragene Leads und
          Empfehlungen), nach Eingangsdatum. Termine vor Ort, Aufträge und Umsatz nach aktuellem Stand dieser Anfragen.
          Werbebudget laut Werbekonto{bericht.manuellSumme > 0 ? " plus weitere erfasste Kosten" : ""}.
        </footer>
      </article>
    </div>
  );
}
