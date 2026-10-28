import type { Metadata } from "next";
import { Info } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { quelleLabel } from "@/lib/lead-utils";
import {
  OHNE_KAMPAGNE,
  aZeitraumGrenzen,
  berechneAuswertung,
  filterLeads,
  leseAZeitraum,
} from "@/lib/auswertung/logik";
import { ladeAuswertungsDaten } from "@/lib/auswertung/daten";
import { FilterLeiste } from "@/components/auswertung/filter-leiste";
import { AuswertungAnsicht, SPRUNG_MARKEN, TippListe } from "@/components/auswertung/auswertung-ansicht";

export const metadata: Metadata = { title: "Auswertung" };
export const dynamic = "force-dynamic";

function eins(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "alle";
}

export default async function AuswertungPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireKunde();
  const sp = await searchParams;
  const zeitraum = leseAZeitraum(sp.zeitraum);
  const jetzt = new Date();
  const { von, bis } = aZeitraumGrenzen(zeitraum, jetzt);
  const db = createAdminClient();

  // Kundenseite: immer nur die eigene Firma (ctx.companyId)
  const daten = await ladeAuswertungsDaten(db, { companyId: ctx.companyId, von, bis });

  const quelle = eins(sp.quelle);
  const kampagne = eins(sp.kampagne);
  const leads = filterLeads(daten.leads, { quelle, kampagne });
  const a = berechneAuswertung({ leads, anrufe: daten.anrufe, termine: daten.termine, jetzt });

  const quellen = [...new Set(daten.leads.map((l) => String(l.quelle)))].sort().map((q) => ({ value: q, label: quelleLabel(q) }));
  const kampagnenSet = [...new Set(daten.leads.map((l) => l.kampagne ?? OHNE_KAMPAGNE))].sort();
  const kampagnen = kampagnenSet.map((k) => ({ value: k, label: k === OHNE_KAMPAGNE ? "Ohne Kampagne" : k }));
  const leadInfo = Object.fromEntries(leads.map((l) => [l.id, { name: l.name ?? "Anfrage", telefon: l.telefon ?? null }]));

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div>
        <h1 className="fern-page-title">Auswertung</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.company.name} · {leads.length} {leads.length === 1 ? "Anfrage" : "Anfragen"} im Zeitraum
        </p>
      </div>

      <FilterLeiste pfad="/auswertung" zeitraum={zeitraum} quelle={quelle} kampagne={kampagne} quellen={quellen} kampagnen={kampagnen} />

      {daten.ohneErfassung && (
        <p className="flex items-start gap-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          Anrufversuche und Termine werden noch nicht gespeichert (Datenbank-Update steht aus). Schnelligkeit und Trichter
          rechnen solange mit dem bisherigen Verlauf.
        </p>
      )}
      {daten.fehler && <p className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">Daten unvollständig: {daten.fehler}</p>}

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Das solltest du wissen</h2>
        <TippListe tipps={a.tipps} />
      </section>

      <nav className="sticky top-0 z-10 -mx-4 flex gap-1.5 overflow-x-auto bg-background/95 px-4 py-2 backdrop-blur" aria-label="Abschnitte">
        {SPRUNG_MARKEN.map((m) => (
          <a key={m.id} href={`#${m.id}`} className="shrink-0 rounded-full bg-muted px-3 py-1.5 text-sm font-semibold hover:bg-muted/70">
            {m.label}
          </a>
        ))}
      </nav>

      <AuswertungAnsicht a={a} modus="kunde" leadInfo={leadInfo} />

      <p className="text-xs text-muted-foreground">
        Gezählt werden Anfragen, die im Zeitraum eingegangen sind – mit allen Anrufen und Terminen dazu. Alle Uhrzeiten in
        deutscher Zeit. Quoten mit weniger als 5 Fällen sind grau („zu wenig Daten“).
      </p>
    </div>
  );
}
