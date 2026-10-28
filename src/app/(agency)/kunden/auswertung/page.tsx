import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTeam } from "@/lib/kontext";
import { quelleLabel } from "@/lib/lead-utils";
import {
  AMPEL_GRENZEN,
  aZeitraumGrenzen,
  ampelQuote,
  ampelSpeed,
  berechneAuswertung,
  filterLeads,
  leseAZeitraum,
  vergleich,
} from "@/lib/auswertung/logik";
import { ladeAuswertungsDaten } from "@/lib/auswertung/daten";
import { FilterLeiste } from "@/components/auswertung/filter-leiste";
import { AuswertungAnsicht, SPRUNG_MARKEN } from "@/components/auswertung/auswertung-ansicht";
import { KundenTabelle, type KundenZeile } from "./kunden-tabelle";

export const metadata: Metadata = { title: "Kunden-Auswertung" };
export const dynamic = "force-dynamic";

function eins(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "alle";
}

export default async function KundenAuswertungPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireTeam();
  const sp = await searchParams;
  const zeitraum = leseAZeitraum(sp.zeitraum);
  const jetzt = new Date();
  const { von, bis } = aZeitraumGrenzen(zeitraum, jetzt);
  const db = createAdminClient();

  const [daten, firmenRes] = await Promise.all([
    ladeAuswertungsDaten(db, { companyId: null, von, bis }),
    db.from("companies").select("id, name, status").order("name"),
  ]);
  const firmen = (firmenRes.data ?? []) as { id: string; name: string; status: string }[];

  const quelle = eins(sp.quelle);
  const leads = filterLeads(daten.leads, { quelle });
  const a = berechneAuswertung({ leads, anrufe: daten.anrufe, termine: daten.termine, jetzt });

  const proFirma = new Map(vergleich(leads, daten.anrufe, daten.termine, (l) => l.company_id ?? "").map((z) => [z.schluessel, z]));
  const zeilen: KundenZeile[] = firmen
    .filter((f) => proFirma.has(f.id) || f.status === "aktiv")
    .map((f) => {
      const z = proFirma.get(f.id);
      const speed = z?.speedMedian ?? null;
      const erreicht = z?.erreichtQuote ?? null;
      const show = z?.showRate ?? null;
      const abschluss = z?.abschlussquote ?? null;
      return {
        companyId: f.id,
        name: f.name,
        anfragen: z?.anfragen ?? 0,
        speedMedian: speed,
        erreichtQuote: erreicht,
        showRate: show,
        abschlussquote: abschluss,
        umsatz: z?.umsatz ?? 0,
        ampel: {
          speed: ampelSpeed(speed),
          erreicht: ampelQuote(erreicht, AMPEL_GRENZEN.erreichtQuote.gruen, AMPEL_GRENZEN.erreichtQuote.gelb),
          show: ampelQuote(show, AMPEL_GRENZEN.showRate.gruen, AMPEL_GRENZEN.showRate.gelb),
          abschluss: ampelQuote(abschluss, AMPEL_GRENZEN.abschlussquote.gruen, AMPEL_GRENZEN.abschlussquote.gelb),
        },
      };
    });

  const quellen = [...new Set(daten.leads.map((l) => String(l.quelle)))].sort().map((q) => ({ value: q, label: quelleLabel(q) }));

  return (
    <div className="space-y-6 pb-10">
      <Link href="/kunden" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Alle Kunden
      </Link>
      <div>
        <h1 className="fern-page-title">Kunden-Auswertung</h1>
        <p className="text-sm text-muted-foreground">
          Sales-Kennzahlen aller Handwerksbetriebe · {leads.length} Anfragen im Zeitraum
        </p>
      </div>

      <FilterLeiste pfad="/kunden/auswertung" zeitraum={zeitraum} quelle={quelle} kampagne="alle" quellen={quellen} kampagnen={[]} />

      {daten.ohneErfassung && (
        <p className="flex items-start gap-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          Migration 00018 (lead_anrufe, lead_termine) ist noch nicht eingespielt – Erreichbarkeit und Termine bleiben leer.
        </p>
      )}
      {daten.fehler && <p className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">Daten unvollständig: {daten.fehler}</p>}

      <section className="fern-card space-y-3 p-5">
        <div>
          <h2 className="text-xl font-bold">Vergleich je Kunde</h2>
          <p className="text-sm text-muted-foreground">
            Ampel: Speed &lt; 15 Min. grün, &lt; 60 Min. gelb · Erreicht ≥ {AMPEL_GRENZEN.erreichtQuote.gruen} % / {AMPEL_GRENZEN.erreichtQuote.gelb} % ·
            Show-Rate ≥ {AMPEL_GRENZEN.showRate.gruen} % / {AMPEL_GRENZEN.showRate.gelb} % · Abschluss ≥ {AMPEL_GRENZEN.abschlussquote.gruen} % /{" "}
            {AMPEL_GRENZEN.abschlussquote.gelb} %. Spaltenkopf antippen zum Sortieren.
          </p>
        </div>
        {zeilen.length === 0 ? <p className="text-sm text-muted-foreground">Keine Kunden mit Anfragen im Zeitraum.</p> : <KundenTabelle zeilen={zeilen} />}
      </section>

      <nav className="sticky top-0 z-10 -mx-4 flex gap-1.5 overflow-x-auto bg-background/95 px-4 py-2 backdrop-blur" aria-label="Abschnitte">
        {SPRUNG_MARKEN.map((m) => (
          <a key={m.id} href={`#${m.id}`} className="shrink-0 rounded-full bg-muted px-3 py-1.5 text-sm font-semibold hover:bg-muted/70">
            {m.label}
          </a>
        ))}
      </nav>

      <AuswertungAnsicht a={a} modus="team" />
    </div>
  );
}
