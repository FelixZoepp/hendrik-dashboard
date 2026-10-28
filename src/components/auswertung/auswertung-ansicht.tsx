import Link from "next/link";
import { AlertTriangle, CalendarX, CheckCircle2, Info, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, quelleLabel } from "@/lib/lead-utils";
import { zeitpunktText } from "@/lib/crm/logik";
import { AnrufenKnopf } from "@/components/crm/kontakt-knoepfe";
import {
  HEATMAP_STUNDEN,
  MIN_STICHPROBE,
  OHNE_KAMPAGNE,
  TAGE_KURZ,
  dauerKurz,
  type Auswertung,
  type QuotenZelle,
  type ShowZelle,
  type Tipp,
  type VergleichZeile,
} from "@/lib/auswertung/logik";

/**
 * Darstellung der Auswertung (Server-Komponente). Gleiche Ansicht für Kunde und Team;
 * im Team-Modus ohne Lead-Listen (Leads öffnet man über „Als Kunde ansehen“).
 */

const pct = (n: number | null | undefined) => (n == null ? "—" : `${n} %`);
const zahl = (n: number) => n.toLocaleString("de-DE");

function Abschnitt({ id, titel, text, children }: { id: string; titel: string; text?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <div>
        <h2 className="text-xl font-bold">{titel}</h2>
        {text && <p className="text-sm text-muted-foreground">{text}</p>}
      </div>
      {children}
    </section>
  );
}

function Karte({ titel, text, children, className }: { titel?: string; text?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("fern-card space-y-3 p-5", className)}>
      {titel && (
        <div>
          <h3 className="text-base font-bold">{titel}</h3>
          {text && <p className="text-xs text-muted-foreground">{text}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

function Kachel({ label, wert, unten, className }: { label: string; wert: string; unten?: string; className?: string }) {
  return (
    <div className="fern-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-3xl font-bold tabular-nums", className)}>{wert}</p>
      {unten && <p className="mt-0.5 text-xs text-muted-foreground">{unten}</p>}
    </div>
  );
}

/** Waagerechter Balken: Breite = Anteil am Maximum; grau = zu wenig Daten. */
function Balken({
  label,
  wert,
  anteil,
  unten,
  grau,
}: {
  label: string;
  wert: string;
  anteil: number;
  unten?: string;
  grau?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className={cn("font-semibold tabular-nums", grau && "text-muted-foreground")}>{wert}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" title={unten}>
        <div
          className={cn("h-full rounded-full", grau ? "bg-muted-foreground/30" : "bg-primary")}
          style={{ width: `${Math.max(0, Math.min(100, anteil * 100))}%` }}
        />
      </div>
      {unten && <p className="text-xs text-muted-foreground">{unten}</p>}
    </div>
  );
}

function quotenBalken(zeilen: Array<QuotenZelle & { label: string }>) {
  const max = Math.max(1, ...zeilen.filter((z) => z.genug).map((z) => z.quote ?? 0));
  return zeilen.map((z) => (
    <Balken
      key={z.label}
      label={z.label}
      wert={z.versuche === 0 ? "—" : z.genug ? pct(z.quote) : "zu wenig Daten"}
      anteil={z.genug ? (z.quote ?? 0) / max : z.versuche > 0 ? 0.05 : 0}
      grau={!z.genug}
      unten={z.versuche > 0 ? `${z.erreicht} von ${z.versuche} Anrufen erreicht` : undefined}
    />
  ));
}

function showTabelle(zeilen: ShowZelle[]) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 font-medium" />
          <th className="py-1 text-right font-medium">Termine</th>
          <th className="py-1 text-right font-medium">No-Shows</th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map((z) => (
          <tr key={z.label} className="border-t border-border/60">
            <td className="py-1.5">{z.label}</td>
            <td className="py-1.5 text-right tabular-nums">{z.entschieden}</td>
            <td className={cn("py-1.5 text-right font-semibold tabular-nums", !z.genug && "font-normal text-muted-foreground")}>
              {z.entschieden === 0 ? "—" : z.genug ? pct(z.noShowQuote) : `${z.noShows} (wenig Daten)`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TIPP_STIL: Record<Tipp["art"], { icon: typeof Info; klasse: string }> = {
  warnung: { icon: AlertTriangle, klasse: "border-sla-rot/30 bg-sla-rot/5 [&_svg]:text-sla-rot" },
  gut: { icon: CheckCircle2, klasse: "border-success/30 bg-success/5 [&_svg]:text-success" },
  info: { icon: Lightbulb, klasse: "border-primary/30 bg-primary/5 [&_svg]:text-primary" },
};

export function TippListe({ tipps }: { tipps: Tipp[] }) {
  if (tipps.length === 0) {
    return (
      <p className="fern-card flex items-center gap-3 p-4 text-base">
        <Info className="size-5 text-muted-foreground" />
        Noch zu wenig Daten für Tipps. Trag nach jedem Anruf kurz ein, wie er lief – dann wird es hier spannend.
      </p>
    );
  }
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {tipps.map((t) => {
        const stil = TIPP_STIL[t.art];
        const Icon = stil.icon;
        const inhalt = (
          <>
            <Icon className="mt-0.5 size-5 shrink-0" />
            <span className="text-base font-medium">{t.text}</span>
          </>
        );
        return (
          <li key={t.id}>
            {t.ziel ? (
              <a href={t.ziel} className={cn("flex h-full gap-3 rounded-2xl border-2 p-4 transition hover:brightness-95", stil.klasse)}>
                {inhalt}
              </a>
            ) : (
              <div className={cn("flex h-full gap-3 rounded-2xl border-2 p-4", stil.klasse)}>{inhalt}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Heatmap({ a }: { a: Auswertung }) {
  const zellen = a.erreichbarkeit.heatmap;
  const max = Math.max(0, ...zellen.flat().filter((z) => z.genug).map((z) => z.quote ?? 0));
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="grid min-w-[560px] gap-1" style={{ gridTemplateColumns: `2rem repeat(${HEATMAP_STUNDEN.length}, 1fr)` }}>
        <div />
        {HEATMAP_STUNDEN.map((h) => (
          <div key={h} className="pb-1 text-center text-[11px] text-muted-foreground">
            {h}
          </div>
        ))}
        {TAGE_KURZ.map((tag, ti) => (
          <div key={tag} className="contents">
            <div className="flex items-center text-xs font-medium text-muted-foreground">{tag}</div>
            {HEATMAP_STUNDEN.map((h, hi) => {
              const z = zellen[ti][hi];
              const v = z.genug ? z.quote : null;
              const t = max > 0 && v != null ? v / max : 0;
              return (
                <div
                  key={h}
                  title={
                    z.versuche === 0
                      ? `${tag} ${h}–${h + 1} Uhr: keine Anrufe`
                      : `${tag} ${h}–${h + 1} Uhr: ${z.erreicht} von ${z.versuche} erreicht${z.genug ? ` (${z.quote} %)` : " – zu wenig Daten"}`
                  }
                  className={cn(
                    "flex aspect-[4/3] items-center justify-center rounded-md text-[10px] font-semibold",
                    v == null && z.versuche > 0 && "bg-[repeating-linear-gradient(45deg,var(--muted),var(--muted)_3px,transparent_3px,transparent_6px)]",
                  )}
                  style={{
                    backgroundColor:
                      v == null ? "var(--muted)" : `color-mix(in oklch, var(--primary) ${Math.round(10 + t * 90)}%, var(--card))`,
                    color: v != null && t > 0.55 ? "white" : "var(--muted-foreground)",
                  }}
                >
                  {v != null ? v : z.versuche > 0 ? "·" : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>0 %</span>
        <span className="h-2 w-32 rounded-full" style={{ background: "linear-gradient(90deg, color-mix(in oklch, var(--primary) 10%, var(--card)), var(--primary))" }} />
        <span>{max} %</span>
        <span className="ml-2">Zahl = % erreicht · grau/Punkt = unter {MIN_STICHPROBE} Anrufe (zu wenig Daten)</span>
      </div>
    </div>
  );
}

function VergleichTabelle({ zeilen, name }: { zeilen: VergleichZeile[]; name: (s: string) => string }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-2 font-medium" />
            <th className="py-2 text-right font-medium">Anfragen</th>
            <th className="py-2 text-right font-medium">Reaktion (Median)</th>
            <th className="py-2 text-right font-medium">Erreicht</th>
            <th className="py-2 text-right font-medium">Termine</th>
            <th className="py-2 text-right font-medium">Show-Rate</th>
            <th className="py-2 text-right font-medium">Aufträge</th>
            <th className="py-2 text-right font-medium">Abschluss</th>
            <th className="py-2 text-right font-medium">Umsatz</th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => (
            <tr key={z.schluessel} className="border-t border-border/60">
              <td className="py-2 font-semibold">{name(z.schluessel)}</td>
              <td className="py-2 text-right tabular-nums">{z.anfragen}</td>
              <td className="py-2 text-right tabular-nums">{dauerKurz(z.speedMedian)}</td>
              <td className="py-2 text-right tabular-nums">{pct(z.erreichtQuote)}</td>
              <td className="py-2 text-right tabular-nums">{z.termine}</td>
              <td className="py-2 text-right tabular-nums">{pct(z.showRate)}</td>
              <td className="py-2 text-right tabular-nums">{z.auftraege}</td>
              <td className="py-2 text-right tabular-nums">{pct(z.abschlussquote)}</td>
              <td className="py-2 text-right tabular-nums">{formatCurrency(z.umsatz)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const SPRUNG_MARKEN = [
  { id: "speed", label: "Schnelligkeit" },
  { id: "erreichbarkeit", label: "Erreichbarkeit" },
  { id: "termine", label: "Termine" },
  { id: "trichter", label: "Von A bis Z" },
  { id: "quellen", label: "Quellen" },
];

export function AuswertungAnsicht({
  a,
  modus,
  leadInfo = {},
}: {
  a: Auswertung;
  modus: "kunde" | "team";
  leadInfo?: Record<string, { name: string; telefon: string | null }>;
}) {
  const s = a.speed;
  const e = a.erreichbarkeit;
  const t = a.termine;
  const tr = a.trichter;
  const kunde = modus === "kunde";

  const bucketMax = Math.max(1, ...s.buckets.map((b) => b.anzahl));
  const tagMax = Math.max(1, ...s.nachWochentag.map((x) => x.median ?? 0));
  const trichterMax = Math.max(1, tr.stufen[0]?.anzahl ?? 0);
  const versuchMax = Math.max(1, ...e.versucheBisErreichen.verteilung.map((v) => v.anzahl));

  return (
    <div className="space-y-8">
      {/* Kennzahlen oben */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kachel
          label="Erster Anruf (Median)"
          wert={dauerKurz(s.ersterVersuch.median)}
          unten={s.ersterVersuch.mittel != null ? `Ø ${dauerKurz(s.ersterVersuch.mittel)}` : "noch keine Anrufe"}
          className={s.ersterVersuch.median == null ? "" : s.ersterVersuch.median < 15 ? "text-sla-gruen" : s.ersterVersuch.median < 60 ? "text-sla-gelb" : "text-sla-rot"}
        />
        <Kachel label="In unter 5 Min." wert={pct(s.innerhalb5)} unten={`unter 15 Min.: ${pct(s.innerhalb15)}`} />
        <Kachel label="Erreicht" wert={pct(e.gesamt.genug ? e.gesamt.quote : null)} unten={`${zahl(e.gesamt.versuche)} Anrufe mit Ergebnis`} />
        <Kachel label="Show-Rate" wert={pct(t.showRate)} unten={`${t.zaehler.nicht_erschienen} No-Shows`} />
        <Kachel label="Abschlussquote" wert={pct(tr.abschlussquote)} unten={`${tr.auftraege} von ${tr.stufen[0]?.anzahl ?? 0} Anfragen`} />
        <Kachel label="Umsatz" wert={formatCurrency(tr.umsatz)} unten={tr.auftragswertMittel != null ? `Ø ${formatCurrency(tr.auftragswertMittel)} je Auftrag` : undefined} className={tr.umsatz > 0 ? "text-success" : ""} />
      </div>

      {/* Speed-to-Lead */}
      <Abschnitt id="speed" titel="Schnelligkeit: Wie schnell rufst du an?" text="Zeit vom Eingang der Anfrage bis zum ersten Anruf/WhatsApp und bis zum ersten Gespräch.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kachel label="Erster Kontaktversuch Ø" wert={dauerKurz(s.ersterVersuch.mittel)} unten={`Median ${dauerKurz(s.ersterVersuch.median)}`} />
          <Kachel label="Erstes Gespräch Ø" wert={dauerKurz(s.erstesErreichen.mittel)} unten={`Median ${dauerKurz(s.erstesErreichen.median)}`} />
          <Kachel label="Unter 5 / 15 Min." wert={`${pct(s.innerhalb5)}`} unten={`unter 15 Min.: ${pct(s.innerhalb15)}`} />
          <Kachel label="Noch nie angerufen" wert={String(s.nieKontaktiert)} className={s.nieKontaktiert > 0 ? "text-sla-rot" : ""} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Karte
            titel="Wie schnell – und was daraus wird"
            text="Anteil der Anfragen je Reaktionszeit und wie viele davon zum Auftrag wurden."
          >
            {s.faktorSchnell != null && (
              <p className="rounded-2xl bg-primary/5 p-3 text-sm font-medium">
                Anfragen, die du in unter 5 Min. anrufst, werden zu {pct(s.quoteSchnell)} Auftrag – später nur zu {pct(s.quoteLangsam)}
                {s.faktorSchnell > 1 ? ` (${s.faktorSchnell.toLocaleString("de-DE")}× so oft)` : ""}.
              </p>
            )}
            <div className="space-y-3">
              {s.buckets.map((b) => (
                <Balken
                  key={b.id}
                  label={b.label}
                  wert={`${b.anzahl} (${pct(b.anteil)})`}
                  anteil={b.anzahl / bucketMax}
                  unten={b.anzahl > 0 ? `Auftrag: ${b.auftraege} von ${b.anzahl} = ${pct(b.abschlussquote)}${b.anzahl < MIN_STICHPROBE ? " · wenig Daten" : ""}` : undefined}
                />
              ))}
            </div>
          </Karte>
          <Karte titel="Reaktionszeit nach Eingang" text="Median bis zum ersten Anruf – je nachdem, wann die Anfrage kam.">
            <div className="space-y-3">
              {s.nachWochentag.map((x) => (
                <Balken
                  key={x.tag}
                  label={x.label}
                  wert={x.anzahl === 0 ? "—" : dauerKurz(x.median)}
                  anteil={(x.median ?? 0) / tagMax}
                  grau={x.anzahl < 3}
                  unten={x.anzahl > 0 ? `${x.anzahl} Anfragen` : undefined}
                />
              ))}
            </div>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {s.nachTageszeit.map((x) => (
                  <tr key={x.id} className="border-t border-border/60">
                    <td className="py-1.5">{x.label}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{x.anzahl} Anfr.</td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{dauerKurz(x.median)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border/60">
                  <td className="py-1.5">Mo–Fr / Wochenende</td>
                  <td className="py-1.5 text-right text-muted-foreground">
                    {s.werktag.anzahl} / {s.wochenende.anzahl}
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">
                    {dauerKurz(s.werktag.median)} / {dauerKurz(s.wochenende.median)}
                  </td>
                </tr>
              </tbody>
            </table>
          </Karte>
        </div>
        {kunde && s.langsamste.length > 0 && (
          <Karte titel="Am längsten gewartet" text="Noch nie angerufene Anfragen zuerst, dann die langsamsten Reaktionen.">
            <ul className="divide-y">
              {s.langsamste.map((l) => (
                <li key={l.leadId} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/leads/${l.leadId}`} className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.name || leadInfo[l.leadId]?.name || "Anfrage"}</p>
                    <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                      Eingang {zeitpunktText(l.eingang)}
                    </p>
                  </Link>
                  <span className={cn("text-sm font-semibold", l.nie ? "text-sla-rot" : "")}>
                    {l.nie ? `wartet seit ${dauerKurz(l.minuten)}` : `nach ${dauerKurz(l.minuten)}`}
                  </span>
                </li>
              ))}
            </ul>
          </Karte>
        )}
      </Abschnitt>

      {/* Erreichbarkeit */}
      <Abschnitt id="erreichbarkeit" titel="Erreichbarkeit: Wann gehen die Leute ran?" text="Nur Anrufe mit eingetragenem Ergebnis. Erreicht = Gespräch (auch „Rückruf gewünscht“).">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kachel label="Erreicht" wert={pct(e.gesamt.quote)} unten={`${e.gesamt.erreicht} von ${e.gesamt.versuche} Anrufen`} />
          <Kachel label="Ø Versuche bis Gespräch" wert={e.versucheBisErreichen.mittel == null ? "—" : e.versucheBisErreichen.mittel.toLocaleString("de-DE", { maximumFractionDigits: 1 })} unten={`${e.versucheBisErreichen.nieErreicht} Leads nie erreicht`} />
          <Kachel label="Mailbox" wert={pct(e.gesamt.mailboxAnteil)} unten={`${e.gesamt.mailbox} Anrufe`} />
          <Kachel label="Falsche Nummer" wert={pct(e.gesamt.falscheNummerAnteil)} unten={`${e.gesamt.falscheNummer} Anrufe`} />
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          <Karte className="xl:col-span-2" titel="Wochentag × Uhrzeit" text="Anteil erreichter Anrufe je Stunde (Berliner Zeit, 7–21 Uhr).">
            <Heatmap a={a} />
          </Karte>
          <Karte titel="Beste Zeiten" text={`Zwei-Stunden-Fenster mit mind. ${MIN_STICHPROBE} Anrufen`}>
            {e.beste.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch zu wenig Anrufe je Zeitfenster.</p>
            ) : (
              <ol className="space-y-2">
                {e.beste.map((b, i) => (
                  <li key={`${b.tag}-${b.block}`} className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{i + 1}</span>
                    <span className="min-w-0 flex-1 font-semibold capitalize">{b.text}</span>
                    <span className="text-lg font-bold tabular-nums">{pct(b.quote)}</span>
                  </li>
                ))}
              </ol>
            )}
            {e.schlechteste.length > 0 && (
              <div className="border-t pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schlechteste Zeiten</p>
                <ul className="space-y-1.5 text-sm">
                  {e.schlechteste.map((b) => (
                    <li key={`s-${b.tag}-${b.block}`} className="flex justify-between">
                      <span className="capitalize">{b.text}</span>
                      <span className="font-semibold tabular-nums">{pct(b.quote)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Karte>
        </div>
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <Karte titel="Je Wochentag">{quotenBalken(e.proTag)}</Karte>
          <Karte titel="Je Uhrzeit">{quotenBalken(e.proBlock)}</Karte>
          <Karte titel="Versuche bis zum Gespräch" text="Bei welchem Anruf hast du die Leute erreicht?">
            {e.versucheBisErreichen.verteilung.map((v) => (
              <Balken key={v.label} label={v.label} wert={`${v.anzahl} (${pct(v.anteil)})`} anteil={v.anzahl / versuchMax} />
            ))}
          </Karte>
          <Karte titel="Quote nach Versuch Nr." text="Lohnt sich der 2., 3. Anruf?">{quotenBalken(e.quoteNachVersuch)}</Karte>
        </div>
        {(e.gesamt.ohneErgebnis > 0 || e.gesamt.whatsapp > 0) && (
          <p className="text-xs text-muted-foreground">
            Nicht in den Quoten: {e.gesamt.ohneErgebnis} Anrufe ohne eingetragenes Ergebnis · {e.gesamt.whatsapp} WhatsApp-Kontakte
            {e.gesamt.ausserhalb > 0 ? ` · ${e.gesamt.ausserhalb} Anrufe außerhalb 7–21 Uhr (nur in den Summen)` : ""}.
          </p>
        )}
      </Abschnitt>

      {/* Termine & No-Shows */}
      <Abschnitt id="termine" titel="Termine & No-Shows" text="Show-Rate = stattgefunden ÷ (stattgefunden + nicht erschienen).">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Kachel label="Termine" wert={String(t.gesamt)} unten={`${t.anstehend} anstehend`} />
          <Kachel label="Stattgefunden" wert={String(t.zaehler.stattgefunden)} />
          <Kachel label="Nicht erschienen" wert={String(t.zaehler.nicht_erschienen)} className={t.zaehler.nicht_erschienen > 0 ? "text-sla-rot" : ""} />
          <Kachel label="Abgesagt / verschoben" wert={`${t.zaehler.abgesagt} / ${t.zaehler.verschoben}`} />
          <Kachel label="Show-Rate" wert={pct(t.showRate)} unten={`No-Show-Rate ${pct(t.noShowRate)}`} />
          <Kachel label="Ohne Rückmeldung" wert={String(t.ohneRueckmeldung)} className={t.ohneRueckmeldung > 0 ? "text-sla-gelb" : ""} unten="vorbei, noch nicht eingetragen" />
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <Karte titel="No-Shows je Wochentag">{showTabelle(t.nachWochentag)}</Karte>
          <Karte titel="No-Shows je Uhrzeit">{showTabelle(t.nachUhrzeit)}</Karte>
          <Karte titel="No-Shows nach Vorlauf" text="Tage zwischen Vereinbarung und Termin">{showTabelle(t.nachVorlauf)}</Karte>
        </div>
        <Karte titel="No-Shows zurückholen" text="Von den nicht erschienenen Terminen: neuer Termin → stattgefunden → Auftrag.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-sm text-muted-foreground">No-Shows</p>
              <p className="text-2xl font-bold">{t.recovery.noShows}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Neuer Termin</p>
              <p className="text-2xl font-bold">
                {t.recovery.mitNeuemTermin} <span className="text-base font-semibold text-muted-foreground">{pct(t.recovery.neuerTerminQuote)}</span>
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Davon stattgefunden</p>
              <p className="text-2xl font-bold">
                {t.recovery.stattgefunden} <span className="text-base font-semibold text-muted-foreground">{pct(t.recovery.stattgefundenQuote)}</span>
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Davon Auftrag</p>
              <p className="text-2xl font-bold">
                {t.recovery.auftrag} <span className="text-base font-semibold text-muted-foreground">{pct(t.recovery.auftragQuote)}</span>
              </p>
            </div>
          </div>
          {kunde && (
            <div id="no-shows" className="scroll-mt-20">
              {t.offeneNoShows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine offenen No-Shows. 👍</p>
              ) : (
                <ul className="divide-y border-t">
                  {t.offeneNoShows.map((n) => (
                    <li key={n.terminId} className="flex items-center gap-3 py-3">
                      <Link href={`/leads/${n.leadId}`} className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{leadInfo[n.leadId]?.name ?? "Anfrage"}</p>
                        <p className="flex items-center gap-1 text-sm text-sla-rot" suppressHydrationWarning>
                          <CalendarX className="size-3.5" /> Termin {zeitpunktText(n.beginn)} verpasst
                        </p>
                      </Link>
                      <AnrufenKnopf leadId={n.leadId} telefon={leadInfo[n.leadId]?.telefon ?? null} zumLead className="h-11 px-4" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Karte>
      </Abschnitt>

      {/* Trichter */}
      <Abschnitt id="trichter" titel="Von der Anfrage zum Auftrag" text="Jede Stufe zählt alle Anfragen, die mindestens so weit gekommen sind.">
        <div className="grid gap-3 lg:grid-cols-3">
          <Karte className="lg:col-span-2">
            <div className="space-y-3">
              {tr.stufen.map((st, i) => (
                <div key={st.id} className="space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <span className="font-semibold">{st.label}</span>
                    <span className="tabular-nums">
                      <span className="text-lg font-bold">{st.anzahl}</span>
                      {i > 0 && (
                        <span className="ml-2 text-muted-foreground">
                          {pct(st.quoteVorschritt)} vom Schritt davor · {pct(st.quoteStart)} aller Anfragen
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-6 overflow-hidden rounded-lg bg-muted">
                    <div className="h-full rounded-lg bg-primary" style={{ width: `${(st.anzahl / trichterMax) * 100}%` }} />
                  </div>
                  {i > 0 && st.dauerMittel != null && (
                    <p className="text-xs text-muted-foreground">
                      Ø {dauerKurz(st.dauerMittel)} nach „{tr.stufen[i - 1].label}“ (Median {dauerKurz(st.dauerMedian)})
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Karte>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Kachel label="Umsatz" wert={formatCurrency(tr.umsatz)} className={tr.umsatz > 0 ? "text-success" : ""} />
              <Kachel label="Ø Auftragswert" wert={tr.auftragswertMittel != null ? formatCurrency(tr.auftragswertMittel) : "—"} />
              <Kachel label="Angebote" wert={String(tr.angebote)} unten={tr.angeboteSumme > 0 ? formatCurrency(tr.angeboteSumme) : undefined} />
              <Kachel label="Angebot → Auftrag" wert={pct(tr.angebotsAbschlussquote)} />
            </div>
            <Karte titel="Verlustgründe" text={`${tr.verloren} verlorene Anfragen`}>
              {tr.verlustGruende.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine verlorenen Anfragen.</p>
              ) : (
                tr.verlustGruende.map((g) => (
                  <Balken key={g.grund} label={g.grund} wert={`${g.anzahl} (${pct(g.anteil)})`} anteil={(g.anteil ?? 0) / 100} />
                ))
              )}
            </Karte>
          </div>
        </div>
      </Abschnitt>

      {/* Quellen & Kampagnen */}
      <Abschnitt id="quellen" titel="Quellen & Kampagnen im Vergleich">
        <Karte titel="Je Quelle">
          {a.quellen.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Anfragen im Zeitraum.</p>
          ) : (
            <VergleichTabelle zeilen={a.quellen} name={(q) => quelleLabel(q)} />
          )}
        </Karte>
        {a.kampagnen.length > 1 && (
          <Karte titel="Je Kampagne">
            <VergleichTabelle zeilen={a.kampagnen} name={(k) => (k === OHNE_KAMPAGNE ? "Ohne Kampagne" : k)} />
          </Karte>
        )}
      </Abschnitt>
    </div>
  );
}
