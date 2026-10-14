import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, ExternalLink, Lock } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { istFreigeschaltet } from "@/lib/whatsapp/admin";
import { berlinTeile, berlinZeitpunkt, formatDatum, formatUhrzeit } from "@/lib/whatsapp/logik";
import { kiAktiv } from "@/lib/gespraeche/analyse";
import { openingMinSek } from "@/lib/gespraeche/close-anrufe";
import { budgetHeute, firefliesAktiv } from "@/lib/gespraeche/fireflies";
import {
  ABBRUCH_BUCKETS,
  abbruchGruende,
  abbruchVerteilung,
  einwandRanking,
  endPhase,
  hookQuote,
  kennzahlen,
  mmss,
  openerVergleich,
  PHASE_LABEL,
  PHASEN,
  type Analyse,
  type GespraechZeile,
  type Phase,
  type Satz,
  type Status,
} from "@/lib/gespraeche/logik";
import { pinAktion } from "../whatsapp/actions";

export const metadata: Metadata = { title: "Gespräche" };
export const dynamic = "force-dynamic";

const PFAD = "/sales/gespraeche";
const LISTE_LIMIT = 50;

const ZEITRAEUME = [
  { wert: "heute", label: "Heute" },
  { wert: "7", label: "7 Tage" },
  { wert: "30", label: "30 Tage" },
] as const;
type Zeitraum = (typeof ZEITRAEUME)[number]["wert"];

const STATUS_LABEL: Record<Status, string> = {
  neu: "wartet",
  hochgeladen: "bei Fireflies",
  transkribiert: "transkribiert",
  analysiert: "analysiert",
  uebersprungen: "übersprungen",
  fehler: "Fehler",
};

interface ListenZeile extends GespraechZeile {
  lead_id: string | null;
  lead_name: string | null;
  datum: string;
  richtung: string | null;
  fehler: string | null;
  transkript: Satz[] | null;
}

const prozent = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)} %`);
const zeit = (iso: string) => `${formatDatum(new Date(iso))}, ${formatUhrzeit(new Date(iso))}`;
const dauer = (s: number | null) => (s === null ? "–" : s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} Min.` : `${s} s`);
const punkteFarbe = (p: number | null) =>
  p === null ? "text-muted-foreground" : p >= 70 ? "text-success" : p >= 50 ? "text-warning-foreground" : "text-destructive";

function vonDatum(z: Zeitraum, jetzt: Date): Date {
  if (z === "heute") {
    const b = berlinTeile(jetzt);
    return berlinZeitpunkt(b.jahr, b.monat, b.tag, 0);
  }
  return new Date(jetzt.getTime() - Number(z) * 24 * 60 * 60_000);
}

function Abschnitt({ titel, beschreibung, children }: { titel: string; beschreibung?: string; children: React.ReactNode }) {
  return (
    <section className="fern-card p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight">{titel}</h2>
        {beschreibung && <p className="mt-0.5 text-sm text-muted-foreground">{beschreibung}</p>}
      </div>
      {children}
    </section>
  );
}

function Kachel({ titel, wert, hinweis }: { titel: string; wert: string; hinweis?: string }) {
  return (
    <div className="rounded-2xl border p-4">
      <p className="text-sm text-muted-foreground">{titel}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{wert}</p>
      {hinweis && <p className="text-xs text-muted-foreground">{hinweis}</p>}
    </div>
  );
}

function FilterLink({ href, aktiv, children }: { href: string; aktiv: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} scroll={false} className={buttonVariants({ variant: aktiv ? "default" : "outline", size: "sm" })}>
      {children}
    </Link>
  );
}

function EinwandTabelle({ zeilen }: { zeilen: ReturnType<typeof einwandRanking> }) {
  if (!zeilen.length) return <p className="text-sm text-muted-foreground">Noch keine Einwände ausgewertet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Einwand</TableHead>
          <TableHead className="text-right">Anzahl</TableHead>
          <TableHead className="text-right">gut behandelt</TableHead>
          <TableHead className="hidden md:table-cell">Beispiel</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {zeilen.slice(0, 10).map((e) => (
          <TableRow key={e.kategorie}>
            <TableCell className="font-medium">{e.kategorie}</TableCell>
            <TableCell className="text-right">{e.anzahl}</TableCell>
            <TableCell className="text-right">{prozent(e.gutAnteil)}</TableCell>
            <TableCell className="hidden max-w-md truncate text-muted-foreground md:table-cell">{e.beispiel ? `„${e.beispiel}“` : "–"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AnalyseDetail({ a }: { a: Analyse }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="leading-relaxed">{a.zusammenfassung}</p>
      <p>
        <span className="text-muted-foreground">Ergebnis:</span> {a.ergebnis} ·{" "}
        <span className="text-muted-foreground">Entscheider:</span> {a.entscheider_erreicht ? "ja" : "nein"} ·{" "}
        <span className="text-muted-foreground">Termin:</span> {a.termin_vereinbart ? "ja" : "nein"}
        {a.opening && (
          <>
            {" "}· <span className="text-muted-foreground">Hook:</span> {a.opening.hook_funktioniert ? "funktioniert" : "nicht"} ·{" "}
            <span className="text-muted-foreground">Gatekeeper:</span> {a.opening.gatekeeper ? "ja" : "nein"}
            {a.opening.abbruch_sekunde !== null && (
              <>
                {" "}· <span className="text-muted-foreground">Abbruch bei</span> {mmss(a.opening.abbruch_sekunde)}
                {a.opening.abbruch_grund && ` (${a.opening.abbruch_grund})`}
              </>
            )}
          </>
        )}
      </p>
      {a.einwaende.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Einwände</p>
          <ul className="mt-1 space-y-1">
            {a.einwaende.map((e, i) => (
              <li key={i}>
                <Badge variant={e.reaktion_gut ? "secondary" : "destructive"}>{e.kategorie}</Badge>{" "}
                <span className="text-muted-foreground">{mmss(e.sekunde)}</span> „{e.zitat}“ → {e.reaktion}
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.fehler.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fehler & besser</p>
          <ol className="mt-1 space-y-2">
            {a.fehler.map((f, i) => (
              <li key={i} className="rounded-xl bg-destructive/5 p-2.5">
                <p className="font-medium">
                  {i + 1}. {f.fehler}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {mmss(f.sekunde)} „{f.zitat}“
                </p>
                <p className="mt-0.5 text-success">Besser: {f.besser}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
      {a.staerken.length > 0 && (
        <p>
          <span className="text-muted-foreground">Stärken:</span> {a.staerken.join(" · ")}
        </p>
      )}
      {a.tipp && (
        <p className="rounded-xl bg-warning/15 p-2.5">
          <strong>Nächstes Mal:</strong> {a.tipp}
        </p>
      )}
    </div>
  );
}

export default async function GespraechePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const fehlerText = typeof sp.fehler === "string" ? sp.fehler : null;

  if (!(await istFreigeschaltet())) {
    return (
      <div className="space-y-6">
        <h1 className="fern-page-title">Gespräche</h1>
        <section className="fern-card max-w-md p-6">
          <p className="mb-4 text-sm text-muted-foreground">
            Transkripte und Analysen enthalten Kundendaten und sind deshalb mit der Admin-PIN geschützt.
          </p>
          <form action={pinAktion} className="flex items-center gap-2">
            <input type="hidden" name="ziel" value="gespraeche" />
            <Lock className="size-4 text-muted-foreground" />
            <Input name="pin" type="password" autoComplete="off" placeholder="Admin-PIN" className="max-w-48" />
            <Button type="submit" size="sm">
              Freischalten
            </Button>
          </form>
          {fehlerText && <p className="mt-3 text-sm text-destructive">{fehlerText}</p>}
        </section>
      </div>
    );
  }

  const zeitraum: Zeitraum = ZEITRAEUME.some((z) => z.wert === sp.zeitraum) ? (sp.zeitraum as Zeitraum) : "7";
  const phase = PHASEN.includes(sp.phase as Phase) ? (sp.phase as Phase) : null;
  const opener = typeof sp.opener === "string" && sp.opener ? sp.opener : null;
  const jetzt = new Date();
  const von = vonDatum(zeitraum, jetzt);
  const svc = createAdminClient();

  const zaehle = (status: Status) => svc.from("gespraeche").select("call_id", { count: "exact", head: true }).eq("status", status);
  const [basis, nNeu, nHoch, nTranskribiert, nFehler, budget] = await Promise.all([
    svc
      .from("gespraeche")
      .select("call_id, user_name, dauer_sek, phase, status, punkte, ergebnis")
      .gte("datum", von.toISOString())
      .order("datum", { ascending: false })
      .limit(5000),
    zaehle("neu"),
    zaehle("hochgeladen"),
    zaehle("transkribiert"),
    zaehle("fehler"),
    budgetHeute(svc, jetzt).catch(() => null),
  ]);
  const alleImZeitraum = (basis.data ?? []) as GespraechZeile[];
  const opener_namen = [...new Set(alleImZeitraum.filter((g) => endPhase(g) === "opening").map((g) => g.user_name ?? "Unbekannt"))].sort();
  const gefiltert = alleImZeitraum.filter(
    (g) => (!phase || endPhase(g) === phase) && (!opener || (g.user_name ?? "Unbekannt") === opener),
  );
  const nUebersprungen = gefiltert.filter((g) => g.status === "uebersprungen").length;
  const k = kennzahlen(gefiltert);
  const nurOpener = alleImZeitraum.filter((g) => !opener || (g.user_name ?? "Unbekannt") === opener);
  const abbruch = abbruchVerteilung(nurOpener);
  const abbruchMax = Math.max(1, ...ABBRUCH_BUCKETS.map((b) => abbruch.buckets[b]), abbruch.keinAbbruch);

  // Liste: nur Gespräche mit Transkript, inkl. vollständigem Transkript
  let liste = svc
    .from("gespraeche")
    .select("call_id, lead_id, lead_name, user_name, richtung, datum, dauer_sek, phase, status, punkte, ergebnis, fehler, transkript")
    .gte("datum", von.toISOString())
    .in("status", ["transkribiert", "analysiert"])
    .order("datum", { ascending: false })
    .limit(LISTE_LIMIT);
  if (phase) liste = liste.eq("phase", phase);
  if (opener) liste = liste.eq("user_name", opener);
  const { data: listeDaten, error: listeFehler } = await liste;
  const gespraeche = (listeDaten ?? []) as ListenZeile[];

  const href = (aenderung: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const werte = { zeitraum, phase, opener, ...aenderung };
    for (const [key, v] of Object.entries(werte)) if (v) p.set(key, v);
    return `${PFAD}?${p.toString()}`;
  };
  const minSek = openingMinSek();
  const ranking = (phase ? [phase] : (["opening", "setting", "closing"] as Phase[])).filter((p) => p !== "sonstiges");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="fern-page-title">Gespräche</h1>
        <p className="text-[15px] text-muted-foreground">
          Automatische Auswertung der Close-Telefonate: Probleme im Opening, Einwände in Opening, Setting und Closing, Erreichbarkeit der Entscheider.
        </p>
      </div>

      {/* Status-Hinweise */}
      <section className="fern-card space-y-1.5 p-5 text-sm">
        <p>
          Ausgewertet werden Setting, Closing und Opening-Calls ab {minSek} s (Fireflies-Budget). Kürzere Openings zählen nur in der Statistik.
        </p>
        <p className="text-muted-foreground">
          Im Zeitraum übersprungen: {nUebersprungen} · wartend auf Upload: {nNeu.count ?? 0} · bei Fireflies: {nHoch.count ?? 0} · transkribiert, noch
          ohne Analyse: {nTranskribiert.count ?? 0}
          {(nFehler.count ?? 0) > 0 && ` · Fehler: ${nFehler.count}`}
          {budget && ` · Fireflies heute ${budget.aufrufe}/${budget.limit} Aufrufe${budget.gesperrt ? " (Rate-Limit, morgen weiter)" : ""}`}
        </p>
        {!kiAktiv() && (
          <p className="flex items-center gap-1.5 text-warning-foreground">
            <CircleAlert className="size-4" /> KI-Auswertung inaktiv: ANTHROPIC_API_KEY ist nicht gesetzt – Transkripte werden gesammelt und später analysiert.
          </p>
        )}
        {!firefliesAktiv() && (
          <p className="flex items-center gap-1.5 text-destructive">
            <CircleAlert className="size-4" /> FIREFLIES_API_KEY fehlt – es wird nichts transkribiert.
          </p>
        )}
        {(nNeu.count ?? 0) > 0 && budget && budget.rest === 0 && (
          <p className="text-muted-foreground">Tagesbudget aufgebraucht – der Rückstand wird ab morgen abgearbeitet (Closing und Setting zuerst).</p>
        )}
      </section>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-2">
        {ZEITRAEUME.map((z) => (
          <FilterLink key={z.wert} href={href({ zeitraum: z.wert })} aktiv={zeitraum === z.wert}>
            {z.label}
          </FilterLink>
        ))}
        <span className="mx-1 h-6 w-px bg-border" />
        <FilterLink href={href({ phase: null })} aktiv={!phase}>
          Alle Phasen
        </FilterLink>
        {PHASEN.map((p) => (
          <FilterLink key={p} href={href({ phase: p })} aktiv={phase === p}>
            {PHASE_LABEL[p]}
          </FilterLink>
        ))}
        {opener_namen.length > 0 && <span className="mx-1 h-6 w-px bg-border" />}
        {opener_namen.length > 0 && (
          <FilterLink href={href({ opener: null })} aktiv={!opener}>
            Alle Mitarbeiter
          </FilterLink>
        )}
        {opener_namen.map((n) => (
          <FilterLink key={n} href={href({ opener: n })} aktiv={opener === n}>
            {n}
          </FilterLink>
        ))}
      </div>

      {basis.error && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">Gespräche nicht ladbar: {basis.error.message}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kachel titel="Calls gesamt" wert={String(k.gesamt)} hinweis="angenommen, mit Aufnahme, ab 15 s" />
        <Kachel titel="Analysiert" wert={String(k.analysiert)} hinweis={k.gesamt ? `${prozent(k.analysiert / k.gesamt)} der Calls` : undefined} />
        <Kachel titel="Ø Punkte" wert={k.schnittPunkte === null ? "–" : `${k.schnittPunkte}/100`} hinweis="Gesprächsführung laut KI" />
        <Kachel titel="Entscheider-Quote" wert={prozent(k.entscheiderQuote)} hinweis="Inhaber/GF am Telefon (analysierte Calls)" />
      </div>

      {ranking.map((p) => (
        <Abschnitt key={p} titel={`Einwände im ${PHASE_LABEL[p]}`} beschreibung="Je Gespräch und Kategorie einmal gezählt · „gut behandelt“ laut KI">
          <EinwandTabelle zeilen={einwandRanking(gefiltert, p)} />
        </Abschnitt>
      ))}

      {(!phase || phase === "opening") && (
        <Abschnitt
          titel="Opening-Probleme"
          beschreibung="Wann Cold Calls enden: Abbruch laut KI, bei nicht hochgeladenen kurzen Calls die Gesprächsdauer."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              {[...ABBRUCH_BUCKETS.map((b) => [b, abbruch.buckets[b]] as const), ["kein Abbruch", abbruch.keinAbbruch] as const].map(([label, n]) => (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
                  <span className="h-2.5 rounded-full bg-primary" style={{ width: `${Math.max(2, (n / abbruchMax) * 100)}%` }} />
                  <span className="w-8 shrink-0 text-right">{n}</span>
                </div>
              ))}
              <p className="pt-2 text-sm">
                Hook funktioniert: <strong>{prozent(hookQuote(nurOpener))}</strong>
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Häufigste Abbruchgründe</p>
              <ul className="space-y-1 text-sm">
                {abbruchGruende(nurOpener).slice(0, 8).map((g) => (
                  <li key={g.grund} className="flex justify-between gap-3">
                    <span>{g.grund}</span>
                    <span className="text-muted-foreground">{g.anzahl}</span>
                  </li>
                ))}
                {abbruchGruende(nurOpener).length === 0 && <li className="text-muted-foreground">Noch keine Daten.</li>}
              </ul>
            </div>
          </div>
          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opener im Vergleich</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Opener</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">analysiert</TableHead>
                  <TableHead className="text-right">Ø Punkte</TableHead>
                  <TableHead className="text-right">Hook</TableHead>
                  <TableHead className="text-right">Gatekeeper</TableHead>
                  <TableHead className="text-right">Entscheider</TableHead>
                  <TableHead className="text-right">Termin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openerVergleich(alleImZeitraum).map((o) => (
                  <TableRow key={o.name}>
                    <TableCell className="font-medium">{o.name}</TableCell>
                    <TableCell className="text-right">{o.calls}</TableCell>
                    <TableCell className="text-right">{o.analysiert}</TableCell>
                    <TableCell className={cn("text-right", punkteFarbe(o.schnittPunkte))}>{o.schnittPunkte ?? "–"}</TableCell>
                    <TableCell className="text-right">{prozent(o.hookQuote)}</TableCell>
                    <TableCell className="text-right">{prozent(o.gatekeeperQuote)}</TableCell>
                    <TableCell className="text-right">{prozent(o.entscheiderQuote)}</TableCell>
                    <TableCell className="text-right">{prozent(o.terminQuote)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">Quoten beziehen sich auf die analysierten Calls (Opening ab {minSek} s).</p>
          </div>
        </Abschnitt>
      )}

      <Abschnitt titel="Gespräche" beschreibung={`Die neuesten ${LISTE_LIMIT} mit Transkript – aufklappen für Analyse und vollständiges Transkript.`}>
        {listeFehler && <p className="text-sm text-destructive">Liste nicht ladbar: {listeFehler.message}</p>}
        {gespraeche.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Gespräche mit Transkript im Zeitraum.</p>
        ) : (
          <ul className="divide-y">
            {gespraeche.map((g) => {
              const a = g.ergebnis;
              const p = endPhase(g);
              return (
                <li key={g.call_id}>
                  <details className="group py-3">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm text-muted-foreground">{zeit(g.datum)}</span>
                      <span className="font-medium">{g.lead_name ?? "Unbekannter Lead"}</span>
                      <Badge variant="secondary">{PHASE_LABEL[p]}</Badge>
                      <span className="text-sm text-muted-foreground">
                        {g.user_name ?? "?"} · {g.richtung === "inbound" ? "eingehend" : "ausgehend"} · {dauer(g.dauer_sek)}
                      </span>
                      <span className={cn("ml-auto text-sm font-semibold", punkteFarbe(g.punkte))}>
                        {g.punkte !== null ? `${g.punkte}/100` : STATUS_LABEL[g.status]}
                      </span>
                      {a && <p className="w-full text-sm text-muted-foreground group-open:hidden">{a.ergebnis}</p>}
                    </summary>
                    <div className="mt-3 space-y-4 rounded-2xl bg-muted/40 p-4">
                      {a ? <AnalyseDetail a={a} /> : <p className="text-sm text-muted-foreground">Noch nicht analysiert{g.fehler ? ` (${g.fehler})` : ""}.</p>}
                      {g.lead_id && (
                        <a
                          href={`https://app.close.com/lead/${g.lead_id}/`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline"
                        >
                          <ExternalLink className="size-3.5" /> In Close öffnen
                        </a>
                      )}
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transkript</p>
                        <div className="max-h-96 space-y-1 overflow-y-auto rounded-xl bg-background p-3 text-sm">
                          {(g.transkript ?? []).map((s, i) => (
                            <p key={i}>
                              <span className="mr-2 font-mono text-xs text-muted-foreground">{mmss(s.start_time)}</span>
                              <span className="font-medium">{s.speaker_name ?? "?"}:</span> {s.text}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Abschnitt>
    </div>
  );
}
