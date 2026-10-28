import { cn } from "@/lib/utils";
import { euro, type Kennzahlen } from "@/lib/kampagne/logik";

export function kennzahlenListe(k: Kennzahlen) {
  return [
    { label: "Werbebudget ausgegeben", wert: euro(k.ausgaben), wichtig: true },
    { label: "Anfragen", wert: String(k.leads), wichtig: true },
    { label: "Kosten je Anfrage", wert: k.kostenJeLead != null ? euro(k.kostenJeLead) : "—", wichtig: true },
    { label: "Termine vor Ort", wert: String(k.termine) },
    { label: "Aufträge", wert: String(k.auftraege) },
    { label: "Umsatz aus Aufträgen", wert: euro(k.umsatz) },
    {
      label: "Für 1 € Werbung",
      wert: k.roi != null ? `${euro(k.roi, { cent: true })} Umsatz` : "—",
    },
    { label: "Kosten je Auftrag", wert: k.kostenJeAuftrag != null ? euro(k.kostenJeAuftrag) : "—" },
  ];
}

/** Große Zahlen, mobil zweispaltig. Druckfreundlich (keine Schatten im Druck). */
export function KennzahlenRaster({ kennzahlen, className }: { kennzahlen: Kennzahlen; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", className)}>
      {kennzahlenListe(kennzahlen).map((z) => (
        <div key={z.label} className="fern-card p-4 sm:p-6 print:border print:border-border print:shadow-none">
          <dt className="text-xs text-muted-foreground sm:text-sm">{z.label}</dt>
          <dd className={cn("mt-1 font-bold tabular-nums", z.wichtig ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl")}>
            {z.wert}
          </dd>
        </div>
      ))}
    </dl>
  );
}
