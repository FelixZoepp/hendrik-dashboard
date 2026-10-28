import type { Metadata } from "next";
import { Magnet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { istFreigeschaltet } from "@/lib/whatsapp/admin";
import { terminBasisUrl } from "@/lib/whatsapp/client";
import { ladeEinstellungen } from "@/lib/whatsapp/einstellungen";
import { funnelWebhookToken, type Eintragung } from "@/lib/funnel/automatik";
import { ladeFunnelEinstellungen } from "@/lib/funnel/einstellungen";
import { SENDEFENSTER, WARTEZEIT_MIN } from "@/lib/funnel/logik";
import { funnelLoeschenAktion, funnelSpeichernAktion, schalterAktion } from "./actions";

export const metadata: Metadata = { title: "Funnels" };
export const dynamic = "force-dynamic";

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

const zeit = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "–";

const SCHALTER = [
  {
    name: "funnel_close_aktiv",
    titel: "🧲 Eintragungen → Close",
    was:
      "Jede Eintragung wird in Close angelegt (oder dem vorhandenen Lead zugeordnet) – mit allen Angaben als Notiz und in gleichnamigen Feldern. " +
      `Nach ${WARTEZEIT_MIN} Min. ohne Termin: Close-Aufgabe „Jetzt anrufen“ und Slack-Meldung in #03-sales (Renney markiert). Mit Termin: kurze Slack-Meldung.`,
    wirkt: "Close und Slack – keine Nachricht an den Lead",
  },
  {
    name: "funnel_whatsapp_aktiv",
    titel: "💬 WhatsApp: PDF-Report + Erinnerung",
    was:
      "PDF-Report sofort nach der Eintragung (Funnels mit hinterlegtem PDF). " +
      `Kein Termin nach ${WARTEZEIT_MIN} Min. → Erinnerung „Termin auswählen“, Mo–Fr ${SENDEFENSTER.von}–${SENDEFENSTER.bis} Uhr (sonst nächster Werktag ${SENDEFENSTER.von} Uhr). ` +
      "Nicht, wenn inzwischen gebucht, geantwortet oder telefonisch ein Termin gelegt wurde, und nur mit Einwilligung und Handynummer.",
    wirkt: "Nachrichten an Leads – zusätzlich gelten Bot-Schalter/Testnummern und die Vorlagen-Schalter auf der WhatsApp-Seite",
  },
] as const;

const STATUS_FARBE: Record<string, string> = {
  erledigt: "bg-success/15 text-success",
  gesendet: "bg-success/15 text-success",
  direkt_gebucht: "bg-success/15 text-success",
  spaeter_gebucht: "bg-success/15 text-success",
  fehler: "bg-destructive/15 text-destructive",
  nicht_gebucht: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};
const STATUS_TEXT: Record<string, string> = {
  offen: "offen",
  laeuft: "läuft",
  erledigt: "✓",
  gesendet: "gesendet",
  uebersprungen: "übersprungen",
  fehler: "Fehler",
  keiner: "–",
  keine: "–",
  direkt_gebucht: "direkt gebucht",
  nicht_gebucht: "kein Termin",
  spaeter_gebucht: "später gebucht",
};
function Status({ wert }: { wert: string | null }) {
  if (!wert) return <span className="text-muted-foreground">–</span>;
  return <Badge className={cn("font-normal", STATUS_FARBE[wert] ?? "bg-secondary text-muted-foreground")}>{STATUS_TEXT[wert] ?? wert}</Badge>;
}

const vorTagen = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

export default async function FunnelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const meldung = typeof sp.meldung === "string" ? sp.meldung : null;
  const fehler = typeof sp.fehler === "string" ? sp.fehler : null;

  const svc = createAdminClient();
  const frei = await istFreigeschaltet();
  const seit30 = vorTagen(30);
  const [e, waE, eintraegeRes, statsRes, vorlagenRes, nutzerRes, fehlerRes] = await Promise.all([
    ladeFunnelEinstellungen(svc).catch(() => null),
    ladeEinstellungen(svc).catch(() => null),
    svc.from("funnel_eintragungen").select("*").order("eingetragen_am", { ascending: false }).limit(40),
    svc.from("funnel_eintragungen").select("funnel, ergebnis, report_status, erinnerung_status, geklickt_am").gte("eingetragen_am", seit30),
    svc.from("wa_vorlagen").select("name, status, kategorie").in("name", ["hs_funnel_report", "hs_funnel_termin"]),
    svc.from("close_users").select("close_id, name").order("name"),
    svc.from("webhook_errors").select("created_at, error").eq("endpoint", "perspective").order("created_at", { ascending: false }).limit(5),
  ]);

  if (!e) {
    return (
      <div className="space-y-6">
        <h1 className="fern-page-title">Funnels</h1>
        <div className="fern-card p-6 text-sm text-destructive">
          Einstellungen nicht lesbar – ist die Migration 00012_funnel_eintragungen eingespielt?
        </div>
      </div>
    );
  }

  const gesperrt = !frei;
  const token = funnelWebhookToken();
  const basis = terminBasisUrl();
  const webhookUrl = (key: string) => `${basis}/api/webhooks/perspective?token=${frei && token ? token : "••••••••"}&funnel=${key}`;
  const eintraege = (eintraegeRes.data ?? []) as Eintragung[];
  const stats = (statsRes.data ?? []) as Array<{ funnel: string; ergebnis: string | null; report_status: string; erinnerung_status: string; geklickt_am: string | null }>;
  const vorlagen = new Map(((vorlagenRes.data ?? []) as Array<{ name: string; status: string | null; kategorie: string | null }>).map((v) => [v.name, v]));
  const nutzer = (nutzerRes.data ?? []) as Array<{ close_id: string; name: string }>;
  const fehlerListe = (fehlerRes.data ?? []) as Array<{ created_at: string; error: string }>;
  const werte: Record<string, boolean> = { funnel_close_aktiv: e.closeAktiv, funnel_whatsapp_aktiv: e.whatsappAktiv };
  const funnels = Object.entries(e.funnels);
  const funnelName = (k: string) => e.funnels[k]?.name ?? k;

  const kennzahl = (f?: string) => {
    const rows = f ? stats.filter((s) => s.funnel === f) : stats;
    const geprueft = rows.filter((r) => r.ergebnis);
    const direkt = geprueft.filter((r) => r.ergebnis === "direkt_gebucht").length;
    const spaeter = geprueft.filter((r) => r.ergebnis === "spaeter_gebucht").length;
    return {
      n: rows.length,
      direkt,
      quote: geprueft.length ? Math.round((direkt / geprueft.length) * 100) : null,
      spaeter,
      reports: rows.filter((r) => r.report_status === "gesendet").length,
      erinnerungen: rows.filter((r) => r.erinnerung_status === "gesendet").length,
      klicks: rows.filter((r) => r.geklickt_am).length,
    };
  };
  const gesamt = kennzahl();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="fern-page-title">Funnels</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Perspective-Eintragungen → Close, PDF-Report per WhatsApp, Nachfassen ohne Termin.
          </p>
        </div>
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
            e.closeAktiv || e.whatsappAktiv ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground",
          )}
        >
          <Magnet className="size-4" />
          {e.closeAktiv && e.whatsappAktiv ? "Alles aktiv" : e.closeAktiv ? "Close aktiv, WhatsApp aus" : e.whatsappAktiv ? "Nur WhatsApp aktiv" : "Alles aus – wartet auf Freigabe"}
        </div>
      </div>

      {meldung && <p className="rounded-2xl bg-success/10 px-4 py-3 text-sm text-success">{meldung}</p>}
      {fehler && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{fehler}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Eintragungen (30 Tage)", wert: String(gesamt.n) },
          { label: `Direkt gebucht (≤ ${WARTEZEIT_MIN} Min.)`, wert: gesamt.quote === null ? "–" : `${gesamt.direkt} · ${gesamt.quote} %` },
          { label: "Später gebucht", wert: String(gesamt.spaeter) },
          { label: "Reports · Erinnerungen · Klicks", wert: `${gesamt.reports} · ${gesamt.erinnerungen} · ${gesamt.klicks}` },
        ].map((k) => (
          <div key={k.label} className="fern-card p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{k.wert}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">

        <Abschnitt titel="WhatsApp-Vorlagen" beschreibung="Einreichen und einschalten auf der Seite WhatsApp-Bot (gleiche Prüfungen wie die Terminbot-Vorlagen).">
          <ul className="space-y-2 text-sm">
            {[
              { name: "hs_funnel_report", text: "PDF-Report + Knopf „Erstgespräch buchen“" },
              { name: "hs_funnel_termin", text: "Erinnerung „Ein Schritt fehlt noch“ + Knopf „Termin auswählen“" },
            ].map((v) => {
              const s = vorlagen.get(v.name);
              const an = waE?.vorlagen_aktiv[v.name] === true;
              return (
                <li key={v.name} className="flex flex-wrap items-center gap-2">
                  <code className="text-xs font-semibold">{v.name}</code>
                  <Badge variant="outline">{s?.status ?? "nicht eingereicht"}</Badge>
                  {s?.kategorie && <Badge variant="outline">{s.kategorie}</Badge>}
                  <Badge className={an ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}>{an ? "An" : "Aus"}</Badge>
                  <span className="w-full text-xs text-muted-foreground">{v.text}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Bot {waE?.bot_aktiv ? "an" : "aus (nur Testnummern)"} · Das PDF muss bei einem Funnel hinterlegt sein, bevor „hs_funnel_report“ eingereicht werden kann (Meta verlangt ein Beispiel).
          </p>
        </Abschnitt>
      </div>

      <Abschnitt titel="Schalter" beschreibung="Beide stehen standardmäßig auf aus. Einschalten erst nach Freigabe durch Felix.">
        <div className="space-y-4">
          {SCHALTER.map((s) => {
            const an = werte[s.name];
            return (
              <div key={s.name} className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <p className="font-medium">{s.titel}</p>
                  <p className="text-sm text-muted-foreground">{s.was}</p>
                  <p className="text-xs text-muted-foreground">Wirkt: {s.wirkt}</p>
                </div>
                <form action={schalterAktion} className="flex shrink-0 items-center gap-3">
                  <input type="hidden" name="name" value={s.name} />
                  <input type="hidden" name="an" value={an ? "0" : "1"} />
                  <Badge className={an ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}>{an ? "An" : "Aus"}</Badge>
                  <Button type="submit" size="sm" variant={an ? "destructive" : "default"} disabled={gesperrt}>
                    {an ? "Ausschalten" : "Einschalten"}
                  </Button>
                </form>
              </div>
            );
          })}
        </div>
      </Abschnitt>

      <Abschnitt
        titel="Funnels"
        beschreibung="Je Funnel eine Webhook-URL (Perspective → Funnel → Integrationen → Webhook). Unbekannte Funnels legen sich bei der ersten Eintragung selbst an."
      >
        <div className="space-y-4">
          {funnels.length === 0 && <p className="text-sm text-muted-foreground">Noch kein Funnel angelegt.</p>}
          {funnels.map(([key, f]) => {
            const k = kennzahl(key);
            return (
              <form key={key} action={funnelSpeichernAktion} className="space-y-3 rounded-2xl border p-4">
                <input type="hidden" name="key" value={key} />
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{f.name}</p>
                  <code className="text-xs text-muted-foreground">{key}</code>
                  {f.report_url ? <Badge variant="outline">mit PDF-Report</Badge> : <Badge variant="outline">ohne Report</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    30 Tage: {k.n} Eintragungen · {k.quote === null ? "–" : `${k.quote} %`} direkt gebucht
                  </span>
                </div>
                <div className="rounded-xl bg-muted px-3 py-2">
                  <p className="text-xs text-muted-foreground">Webhook-URL (POST)</p>
                  <code className="break-all text-xs">{webhookUrl(key)}</code>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Name</span>
                    <Input name="name" defaultValue={f.name} disabled={gesperrt} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Buchungslink (leer = Erstgespräch-Link des Bots)</span>
                    <Input name="buchungslink" defaultValue={f.buchungslink ?? ""} placeholder={waE?.buchungslinks.erstgespraech ?? "https://calendly.com/…"} disabled={gesperrt} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">PDF-Report (https-Link, leer = kein Report)</span>
                    <Input name="report_url" defaultValue={f.report_url ?? ""} placeholder="https://cloud.hoffmannsolutions.de/reports/…pdf" disabled={gesperrt} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Report-Titel (steht in der Nachricht)</span>
                    <Input name="report_titel" defaultValue={f.report_titel ?? ""} disabled={gesperrt} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Dateiname in WhatsApp</span>
                    <Input name="report_dateiname" defaultValue={f.report_dateiname ?? ""} placeholder="Report.pdf" disabled={gesperrt} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Aufgabe „Jetzt anrufen“ für</span>
                    <select
                      name="zustaendig"
                      defaultValue={f.zustaendig ?? ""}
                      disabled={gesperrt}
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="">niemand Bestimmtes</option>
                      {nutzer.map((u) => (
                        <option key={u.close_id} value={u.close_id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-col gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="erinnerung" value="1" defaultChecked={f.erinnerung} disabled={gesperrt} />
                    WhatsApp-Erinnerung „Termin auswählen“ nach {WARTEZEIT_MIN} Min. ohne Buchung
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="einwilligung_ohne_haekchen" value="1" defaultChecked={f.einwilligung_ohne_haekchen} disabled={gesperrt} />
                    Funnel hat kein WhatsApp-Häkchen – Angabe der Handynummer gilt als Einwilligung (Hinweis im Funnel nötig)
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={gesperrt}>
                    Speichern
                  </Button>
                  <Button type="submit" size="sm" variant="outline" formAction={funnelLoeschenAktion} disabled={gesperrt}>
                    Entfernen
                  </Button>
                </div>
              </form>
            );
          })}

          <form action={funnelSpeichernAktion} className="flex flex-col gap-2 rounded-2xl border border-dashed p-4 sm:flex-row sm:items-end">
            <input type="hidden" name="neu" value="1" />
            <label className="flex-1 space-y-1 text-sm">
              <span className="text-muted-foreground">Neuer Funnel – Name</span>
              <Input name="name" placeholder="z. B. Report Neukundengewinnung" disabled={gesperrt} />
            </label>
            <label className="space-y-1 text-sm sm:w-56">
              <span className="text-muted-foreground">Kurzname (optional)</span>
              <Input name="key" placeholder="report" disabled={gesperrt} />
            </label>
            <Button type="submit" size="sm" disabled={gesperrt}>
              Anlegen
            </Button>
          </form>
        </div>
      </Abschnitt>

      <Abschnitt titel="Letzte Eintragungen" beschreibung="Neueste zuerst. Close, Report, Ergebnis nach 10 Minuten und Erinnerung.">
        {eintraege.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Eintragungen.</p>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">Zeit</th>
                  <th className="px-2 py-2 font-medium">Funnel</th>
                  <th className="px-2 py-2 font-medium">Lead</th>
                  <th className="px-2 py-2 font-medium">Close</th>
                  <th className="px-2 py-2 font-medium">Report</th>
                  <th className="px-2 py-2 font-medium">Nach 10 Min.</th>
                  <th className="px-2 py-2 font-medium">Erinnerung</th>
                </tr>
              </thead>
              <tbody>
                {eintraege.map((x) => (
                  <tr key={x.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums">{zeit(x.eingetragen_am)}</td>
                    <td className="px-2 py-2">{funnelName(x.funnel)}</td>
                    <td className="px-2 py-2">
                      <p className="font-medium">{x.name ?? x.firma ?? "–"}</p>
                      <p className="text-xs text-muted-foreground">
                        {[x.firma && x.firma !== x.name ? x.firma : null, x.telefon ?? x.telefon_roh, x.email].filter(Boolean).join(" · ")}
                      </p>
                      {!x.opt_in && <p className="text-xs text-muted-foreground">keine WhatsApp-Einwilligung</p>}
                    </td>
                    <td className="px-2 py-2">
                      {x.close_lead_id ? (
                        <a className="text-primary underline-offset-2 hover:underline" href={`https://app.close.com/lead/${x.close_lead_id}/`} target="_blank" rel="noreferrer">
                          {x.close_neu ? "neu" : "vorhanden"}
                        </a>
                      ) : (
                        <Status wert={x.close_status} />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Status wert={x.report_status} />
                    </td>
                    <td className="px-2 py-2">
                      <Status wert={x.ergebnis ?? (x.pruef_status === "offen" ? null : x.pruef_status)} />
                    </td>
                    <td className="px-2 py-2">
                      <Status wert={x.erinnerung_status} />
                      {x.erinnerung_status === "offen" && <p className="text-xs text-muted-foreground">{zeit(x.erinnerung_am)}</p>}
                      {x.geklickt_am && <p className="text-xs text-success">Knopf geklickt</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {fehlerListe.length > 0 && (
          <div className="mt-4 space-y-1">
            <p className="text-sm font-medium text-destructive">Letzte Fehler</p>
            {fehlerListe.map((f) => (
              <p key={f.created_at} className="text-xs text-muted-foreground">
                {zeit(f.created_at)}: {f.error.slice(0, 200)}
              </p>
            ))}
          </div>
        )}
      </Abschnitt>
    </div>
  );
}
