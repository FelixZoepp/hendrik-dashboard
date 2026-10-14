import type { Metadata } from "next";
import { CheckCircle2, CircleAlert, Lock, MessageCircle, Unlock } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminPinZustand, istFreigeschaltet } from "@/lib/whatsapp/admin";
import { terminBasisUrl, waVerbindung, WA_ENV_PFLICHT, WA_ENV_WEITERE } from "@/lib/whatsapp/client";
import { ladeEinstellungen } from "@/lib/whatsapp/einstellungen";
import { bestaetigungsQuote, formatDatum, formatUhrzeit, type QuoteWert, type TerminArt } from "@/lib/whatsapp/logik";
import type { Termin } from "@/lib/whatsapp/termine";
import { pruefeVorlage, VORLAGEN } from "@/lib/whatsapp/vorlagen";
import {
  abgleichenAktion,
  einreichenAktion,
  einstellungenAktion,
  hauptschalterAktion,
  pinAktion,
  sperrenAktion,
  testnummernAktion,
  vorlageSchalterAktion,
  calendlyWebhookAktion,
  closeFeldAktion,
  closeStatusFeldAktion,
} from "./actions";

export const metadata: Metadata = { title: "WhatsApp-Bot" };
export const dynamic = "force-dynamic";

interface VorlageStatus {
  name: string;
  status: string | null;
  kategorie: string | null;
  ablehnungsgrund: string | null;
  geprueft_am: string | null;
}

interface JobZeile {
  termin_id: string;
  typ: string;
  run_at: string;
  status: string;
  ergebnis: string | null;
  fehler: string | null;
}

interface NachrichtZeile {
  id: string;
  richtung: "aus" | "ein";
  telefon: string;
  typ: string | null;
  vorlage: string | null;
  body: string | null;
  status: string;
  fehler: string | null;
  created_at: string;
}

const JOB_LABEL: Record<string, string> = {
  gebucht: "Buchung",
  erinnerung: "Erinnerung",
  unbestaetigt_check: "Nachfassen",
  gleich: "Gleich",
  verpasst: "Verpasst",
  abgesagt: "Abgesagt",
};

const zeit = (iso: string) => `${formatDatum(new Date(iso))}, ${formatUhrzeit(new Date(iso))}`;

/** +49 151 ••• 78 — vollständige Nummern nur nach Freischaltung (Auth ist aus). */
const maskiere = (tel: string) => `${tel.slice(0, 6)} ••• ${tel.slice(-2)}`;

function Abschnitt({ titel, beschreibung, children, aktion }: {
  titel: string;
  beschreibung?: string;
  children: React.ReactNode;
  aktion?: React.ReactNode;
}) {
  return (
    <section className="fern-card p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{titel}</h2>
          {beschreibung && <p className="mt-0.5 text-sm text-muted-foreground">{beschreibung}</p>}
        </div>
        {aktion}
      </div>
      {children}
    </section>
  );
}

/** „68 %“ + „17 von 25“ — ohne zugestellte Buchungsnachricht „–“. */
function QuoteKachel({ titel, wert }: { titel: string; wert: QuoteWert }) {
  const prozent = wert.von ? Math.round((wert.bestaetigt / wert.von) * 100) : null;
  return (
    <div className="rounded-2xl border p-4">
      <p className="text-sm text-muted-foreground">{titel}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{prozent === null ? "–" : `${prozent} %`}</p>
      <p className="text-xs text-muted-foreground">
        {wert.bestaetigt} von {wert.von} bestätigt
      </p>
    </div>
  );
}

/** Termine der letzten 30 Tage und kommende + Schlüssel ihrer zugestellten/gelesenen Buchungsnachricht. */
async function ladeQuote(svc: ReturnType<typeof createAdminClient>, jetzt: Date) {
  const { data, error } = await svc
    .from("wa_termine")
    .select("id, art, status, bestaetigt_am")
    .gte("start_at", new Date(jetzt.getTime() - 30 * 24 * 60 * 60_000).toISOString())
    .neq("status", "abgesagt");
  if (error) return null;
  const termine = (data ?? []) as Array<{ id: string; art: TerminArt; status: string; bestaetigt_am: string | null }>;
  const schluessel = termine.map((t) => `${t.id}|gebucht`);
  const zugestellt = new Set<string>();
  // In Blöcken abfragen (URL-Länge)
  for (let i = 0; i < schluessel.length; i += 100) {
    const { data: n, error: nFehler } = await svc
      .from("wa_nachrichten")
      .select("versand_schluessel")
      .in("versand_schluessel", schluessel.slice(i, i + 100))
      .in("status", ["zugestellt", "gelesen"]);
    if (nFehler) return null;
    for (const z of (n ?? []) as Array<{ versand_schluessel: string }>) zugestellt.add(z.versand_schluessel);
  }
  return bestaetigungsQuote(termine, zugestellt);
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? "nicht eingereicht";
  const farbe =
    s === "APPROVED"
      ? "bg-success/15 text-success"
      : s === "REJECTED" || s === "DISABLED" || s === "PAUSED"
        ? "bg-destructive/10 text-destructive"
        : s === "nicht eingereicht"
          ? "bg-secondary text-muted-foreground"
          : "bg-warning/20 text-warning-foreground";
  return <Badge className={farbe}>{s}</Badge>;
}

export default async function WhatsappBotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const meldung = typeof sp.meldung === "string" ? sp.meldung : null;
  const fehler = typeof sp.fehler === "string" ? sp.fehler : null;

  const svc = createAdminClient();
  const frei = await istFreigeschaltet();
  const verbindung = waVerbindung();
  const jetzt = new Date();

  const [einstellungen, vorlagenRes, termineRes, nachrichtenRes, quote] = await Promise.all([
    ladeEinstellungen(svc).catch(() => null),
    svc.from("wa_vorlagen").select("name, status, kategorie, ablehnungsgrund, geprueft_am"),
    svc
      .from("wa_termine")
      .select("*")
      .gte("start_at", new Date(jetzt.getTime() - 2 * 60 * 60_000).toISOString())
      .order("start_at", { ascending: true })
      .limit(50),
    svc
      .from("wa_nachrichten")
      .select("id, richtung, telefon, typ, vorlage, body, status, fehler, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    ladeQuote(svc, jetzt).catch(() => null),
  ]);

  if (!einstellungen) {
    return (
      <div className="space-y-6">
        <h1 className="fern-page-title">WhatsApp-Bot</h1>
        <div className="fern-card p-6 text-sm text-destructive">
          Die Bot-Tabellen fehlen noch — Migration 00009_whatsapp_terminbot.sql ist nicht eingespielt.
        </div>
      </div>
    );
  }

  const vorlagenStatus = new Map(((vorlagenRes.data ?? []) as VorlageStatus[]).map((v) => [v.name, v]));
  const termine = (termineRes.data ?? []) as Termin[];
  const nachrichten = (nachrichtenRes.data ?? []) as NachrichtZeile[];
  const { data: jobsData } = termine.length
    ? await svc
        .from("wa_jobs")
        .select("termin_id, typ, run_at, status, ergebnis, fehler")
        .in("termin_id", termine.map((t) => t.id))
        .order("run_at", { ascending: true })
    : { data: [] };
  const jobs = (jobsData ?? []) as JobZeile[];

  const gesperrt = !frei;
  const aktiv = einstellungen.bot_aktiv && verbindung.verbunden;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="fern-page-title">WhatsApp-Bot</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Terminbestätigung und Erinnerungen für Erst- und Strategiegespräche
          </p>
        </div>
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
            aktiv ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground",
          )}
        >
          <MessageCircle className="size-4" />
          {aktiv
            ? "Bot sendet an alle Leads mit Einwilligung"
            : einstellungen.testnummern.length && verbindung.verbunden
              ? "Testbetrieb — nur Testnummern"
              : "Bot sendet nichts"}
        </div>
      </div>

      {meldung && <p className="rounded-2xl bg-success/10 px-4 py-3 text-sm text-success">{meldung}</p>}
      {fehler && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{fehler}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Abschnitt
          titel="Verbindung"
          beschreibung={verbindung.verbunden ? "WhatsApp ist verbunden." : "Nicht verbunden — der Bot sendet nichts."}
        >
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {[...WA_ENV_PFLICHT, ...WA_ENV_WEITERE].map((k) => {
              const gesetzt = !!process.env[k];
              const pflicht = (WA_ENV_PFLICHT as readonly string[]).includes(k);
              return (
                <li key={k} className="flex items-center gap-2">
                  {gesetzt ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : (
                    <CircleAlert className={cn("size-4", pflicht ? "text-destructive" : "text-muted-foreground")} />
                  )}
                  <code className="text-xs">{k}</code>
                  {!gesetzt && !pflicht && <span className="text-xs text-muted-foreground">(optional/Standard)</span>}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Knopf-Links zeigen auf {terminBasisUrl()}</p>
        </Abschnitt>

        <Abschnitt
          titel="Freischaltung"
          beschreibung="Schalter, Einreichen und Kontaktdaten sind mit der Admin-PIN geschützt."
        >
          {adminPinZustand() === "fehlt" ? (
            <p className="text-sm text-destructive">WHATSAPP_ADMIN_PIN ist nicht gesetzt — Änderungen sind gesperrt.</p>
          ) : adminPinZustand() === "zu_kurz" ? (
            <p className="text-sm text-destructive">PIN zu kurz – bitte in Vercel ändern (mind. 10 Zeichen).</p>
          ) : frei ? (
            <form action={sperrenAktion} className="flex items-center gap-3">
              <span className="inline-flex items-center gap-2 text-sm text-success">
                <Unlock className="size-4" /> Freigeschaltet
              </span>
              <Button type="submit" variant="outline" size="sm">
                Sperren
              </Button>
            </form>
          ) : (
            <form action={pinAktion} className="flex items-center gap-2">
              <Lock className="size-4 text-muted-foreground" />
              <Input name="pin" type="password" autoComplete="off" placeholder="Admin-PIN" className="max-w-48" />
              <Button type="submit" size="sm">
                Freischalten
              </Button>
            </form>
          )}
        </Abschnitt>

        <Abschnitt
          titel="Hauptschalter"
          beschreibung="Aus: Nachrichten gehen nur an Testnummern. An: an alle Leads mit Einwilligung."
        >
          <form action={hauptschalterAktion} className="flex items-center gap-3">
            <input type="hidden" name="an" value={einstellungen.bot_aktiv ? "0" : "1"} />
            <Badge className={einstellungen.bot_aktiv ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}>
              {einstellungen.bot_aktiv ? "Bot an" : "Bot aus"}
            </Badge>
            <Button type="submit" size="sm" variant={einstellungen.bot_aktiv ? "destructive" : "default"} disabled={gesperrt}>
              {einstellungen.bot_aktiv ? "Bot ausschalten" : "Bot einschalten"}
            </Button>
          </form>
        </Abschnitt>

        <Abschnitt titel="Testnummern" beschreibung="Eine Nummer pro Zeile. Diese Nummern bekommen Nachrichten auch bei ausgeschaltetem Bot.">
          {frei ? (
            <form action={testnummernAktion} className="space-y-2">
              <Textarea name="testnummern" rows={3} defaultValue={einstellungen.testnummern.join("\n")} placeholder="+49 151 23456789" />
              <Button type="submit" size="sm">
                Speichern
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              {einstellungen.testnummern.length
                ? einstellungen.testnummern.map(maskiere).join(", ")
                : "Keine Testnummern hinterlegt."}
            </p>
          )}
        </Abschnitt>
      </div>

      <Abschnitt
        titel="Bestätigungsquote"
        beschreibung="Termine der letzten 30 Tage und kommende, deren Buchungsnachricht zugestellt wurde — davon bestätigt. Abgesagte zählen nicht."
      >
        {quote ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <QuoteKachel titel="Gesamt" wert={quote.gesamt} />
            <QuoteKachel titel="Erstgespräch" wert={quote.erstgespraech} />
            <QuoteKachel titel="Strategiegespräch" wert={quote.strategie} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Quote nicht ladbar.</p>
        )}
      </Abschnitt>

      <Abschnitt
        titel="Vorlagen"
        beschreibung="Nur eingeschaltete UND bei Meta freigegebene Vorlagen werden gesendet. Einreichen nur per Knopf."
        aktion={
          <form action={abgleichenAktion}>
            <Button type="submit" size="sm" variant="outline" disabled={gesperrt || !verbindung.verbunden}>
              Status abgleichen
            </Button>
          </form>
        }
      >
        <div className="space-y-3">
          {VORLAGEN.map((v) => {
            const s = vorlagenStatus.get(v.name);
            const an = einstellungen.vorlagen_aktiv[v.name] === true;
            const probleme = pruefeVorlage(v);
            const einreichbar = !s?.status || s.status === "FEHLER";
            return (
              <div key={v.name} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-sm font-semibold">{v.name}</code>
                  <StatusBadge status={s?.status ?? null} />
                  <Badge variant="outline">{v.kategorie}</Badge>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {einreichbar && (
                      <form action={einreichenAktion}>
                        <input type="hidden" name="name" value={v.name} />
                        <Button type="submit" size="sm" variant="outline" disabled={gesperrt || !verbindung.verbunden || probleme.length > 0}>
                          Bei Meta einreichen
                        </Button>
                      </form>
                    )}
                    <form action={vorlageSchalterAktion}>
                      <input type="hidden" name="name" value={v.name} />
                      <input type="hidden" name="an" value={an ? "0" : "1"} />
                      <Button type="submit" size="sm" variant={an ? "secondary" : "default"} disabled={gesperrt}>
                        {an ? "Ausschalten" : "Einschalten"}
                      </Button>
                    </form>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {an ? "Eingeschaltet" : "Ausgeschaltet"}
                  {s?.geprueft_am && <> · geprüft {zeit(s.geprueft_am)}</>}
                </p>
                {s?.kategorie && s.kategorie !== "UTILITY" && (
                  <p className="mt-1 text-xs font-medium text-destructive">
                    Von Meta auf {s.kategorie === "MARKETING" ? "Marketing" : s.kategorie} umgestuft — wird nicht gesendet
                  </p>
                )}
                {s?.ablehnungsgrund && <p className="mt-1 text-xs text-destructive">Abgelehnt: {s.ablehnungsgrund}</p>}
                {probleme.length > 0 && <p className="mt-1 text-xs text-destructive">{probleme.join(" · ")}</p>}
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Text ansehen</summary>
                  <div className="mt-2 space-y-1 rounded-xl bg-muted p-3">
                    {v.header && <p className="font-semibold">{v.header}</p>}
                    <p className="whitespace-pre-line">{v.body}</p>
                    <p className="text-xs text-muted-foreground">{v.footer}</p>
                    <p className="text-xs">
                      Knöpfe: {v.buttons.map((b) => (b.typ === "URL" ? `${b.text} → /${b.pfad}/…` : b.text)).join(" · ")}
                    </p>
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      </Abschnitt>

      <Abschnitt
        titel="Einstellungen"
        beschreibung="Videos erscheinen auf der Termin-Seite und nach der Bestätigung (mp4-Links kommen direkt als Video)."
      >
        <form action={einstellungenAktion} className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["video_erstgespraech", "Video Erstgespräch", einstellungen.videos.erstgespraech],
              ["video_strategie", "Video Strategiegespräch", einstellungen.videos.strategie],
              ["buchung_erstgespraech", "Buchungslink Erstgespräch", einstellungen.buchungslinks.erstgespraech],
              ["buchung_strategie", "Buchungslink Strategiegespräch", einstellungen.buchungslinks.strategie],
            ] as const
          ).map(([name, label, wert]) => (
            <label key={name} className="space-y-1 text-sm">
              <span className="font-medium">{label}</span>
              <Input name={name} defaultValue={wert ?? ""} placeholder="https://…" disabled={gesperrt} />
            </label>
          ))}
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="font-medium">Close-Feld für WhatsApp-Einwilligung</span>
            <Input
              name="close_optin_feld"
              defaultValue={einstellungen.close_optin_feld ?? ""}
              placeholder="custom.cf_… (Wert „Ja“ = Einwilligung) — leer: Close-Termine bekommen keine Nachrichten"
              disabled={gesperrt}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="font-medium">Close-Feld für den Bestätigungsstatus</span>
            <Input
              name="close_status_feld"
              defaultValue={einstellungen.close_status_feld ?? ""}
              placeholder="custom.cf_… (Lead-Feld „WhatsApp-Termin“) — leer: Status wird nicht in Close geschrieben"
              disabled={gesperrt}
            />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={gesperrt}>
              Einstellungen speichern
            </Button>
          </div>
        </form>
      </Abschnitt>

      <Abschnitt
        titel="Einrichtung"
        beschreibung="Einmalig: Einwilligungs- und Statusfeld in Close anlegen und Calendly-Buchungen an den Bot melden. Mehrfaches Klicken schadet nicht."
      >
        <div className="flex flex-wrap gap-2">
          <form action={closeFeldAktion}>
            <Button type="submit" size="sm" variant="outline" disabled={gesperrt}>
              Close-Feld anlegen
            </Button>
          </form>
          <form action={closeStatusFeldAktion}>
            <Button type="submit" size="sm" variant="outline" disabled={gesperrt}>
              Close-Statusfeld anlegen
            </Button>
          </form>
          <form action={calendlyWebhookAktion}>
            <Button type="submit" size="sm" variant="outline" disabled={gesperrt}>
              Calendly-Webhook einrichten
            </Button>
          </form>
        </div>
      </Abschnitt>

      <Abschnitt titel="Kommende Termine" beschreibung="Ab 2 Stunden zurück, max. 50">
        {termine.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Termine.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Termin</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Nachrichten-Plan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {termine.map((t) => (
                <TableRow key={t.id} className="align-top">
                  <TableCell className="whitespace-nowrap">
                    <div className="font-medium">{zeit(t.start_at)}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.art === "strategie" ? "Strategiegespräch" : "Erstgespräch"} · {t.quelle === "calendly" ? "Calendly" : "Close"}
                    </div>
                  </TableCell>
                  <TableCell>
                    {frei ? (
                      <>
                        <div>{t.name ?? t.firma ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{t.telefon ?? "keine Nummer"}</div>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t.telefon ? maskiere(t.telefon) : "keine Nummer"}</span>
                    )}
                  </TableCell>
                  <TableCell className="space-y-1">
                    <Badge variant="outline">{t.status}</Badge>
                    <div className="text-xs">
                      {t.bestaetigt_am ? (
                        <span className="text-success">bestätigt</span>
                      ) : t.verschieben_am ? (
                        <span className="text-warning-foreground">möchte verschieben</span>
                      ) : (
                        <span className="text-muted-foreground">unbestätigt</span>
                      )}
                      {!t.opt_in && <span className="text-muted-foreground"> · ohne Einwilligung</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ul className="space-y-0.5 text-xs">
                      {jobs
                        .filter((j) => j.termin_id === t.id)
                        .map((j) => (
                          <li key={j.typ} title={j.fehler ?? j.ergebnis ?? undefined}>
                            <span className="font-medium">{JOB_LABEL[j.typ] ?? j.typ}</span> {formatUhrzeit(new Date(j.run_at))} ·{" "}
                            <span
                              className={cn(
                                j.status === "erledigt" && "text-success",
                                j.status === "fehler" && "text-destructive",
                                (j.status === "uebersprungen" || j.status === "abgebrochen") && "text-muted-foreground",
                              )}
                            >
                              {j.status}
                            </span>
                            {(j.status === "uebersprungen" || j.status === "fehler") && (j.fehler ?? j.ergebnis) && (
                              <span className="text-muted-foreground"> ({j.fehler ?? j.ergebnis})</span>
                            )}
                          </li>
                        ))}
                    </ul>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Abschnitt>

      <Abschnitt titel="Letzte Nachrichten" beschreibung="Die letzten 100 ein- und ausgehenden Nachrichten">
        {nachrichten.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Nachrichten.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zeit</TableHead>
                <TableHead>Richtung</TableHead>
                <TableHead>Nummer</TableHead>
                <TableHead>Inhalt</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nachrichten.map((n) => (
                <TableRow key={n.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-xs">{zeit(n.created_at)}</TableCell>
                  <TableCell className="text-xs">{n.richtung === "aus" ? "→ gesendet" : "← empfangen"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{frei ? n.telefon : maskiere(n.telefon)}</TableCell>
                  <TableCell className="max-w-md text-xs">
                    {n.vorlage && <code className="mr-1">{n.vorlage}</code>}
                    {frei ? <span className="whitespace-pre-line">{n.body}</span> : <span className="text-muted-foreground">[nach Freischaltung]</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className={cn(n.status === "fehlgeschlagen" && "text-destructive")}>{n.status}</span>
                    {n.fehler && <div className="text-destructive">{n.fehler}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Abschnitt>
    </div>
  );
}
