import type { Metadata } from "next";
import { CheckCircle2, CircleAlert, Tag } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { istFreigeschaltet } from "@/lib/whatsapp/admin";
import { ladeVerlustgrundEinstellungen } from "@/lib/verlustgrund/automatik";
import { aufgabenText, VERLUSTGRUENDE, VERLUSTGRUND_FELDNAME } from "@/lib/verlustgrund/logik";
import { felderAnlegenAktion, schalterAktion } from "./actions";

export const metadata: Metadata = { title: "Verlustgrund" };
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

const SCHALTER = [
  {
    name: "verlustgrund_automatisch",
    titel: "🏷️ Verlustgrund aus dem Protokoll",
    was:
      "Setting „Nicht qualifiziert“/„Disqualifiziert“ oder Closing „Unqualifiziert“ mit ausgefülltem Feld „Verlustgrund“ → " +
      "der Grund wird in die verlorene Opportunity (Feld „Verlustgrund“) übernommen. Ohne Grund bleibt es bei der Aufgabe (falls eingeschaltet).",
    wirkt: "Nur ein Feld in Close – keine Nachricht an den Lead",
  },
  {
    name: "verlustgrund_aufgabe",
    titel: "❓ Verlustgrund-Pflicht",
    was:
      "Protokoll setzt die Opportunity ohne Grund auf „Verloren“ → sofort Close-Aufgabe für den Protokoll-Ersteller. " +
      "Opportunity manuell in Close auf verloren gesetzt und nach 30 Minuten kein Grund → Aufgabe für den Verantwortlichen der Opportunity (Prüfung im stündlichen Close-Sync). " +
      "Höchstens eine Aufgabe pro Opportunity und Tag, keine zweite, solange eine offen ist.",
    wirkt: "Close-Aufgaben für das Team – keine Nachricht an Leads",
  },
] as const;

export default async function VerlustgrundPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const meldung = typeof sp.meldung === "string" ? sp.meldung : null;
  const fehler = typeof sp.fehler === "string" ? sp.fehler : null;

  const svc = createAdminClient();
  const frei = await istFreigeschaltet();
  const [e, fehlerRes] = await Promise.all([
    ladeVerlustgrundEinstellungen(svc).catch(() => null),
    svc
      .from("webhook_errors")
      .select("created_at, error")
      .eq("endpoint", "verlustgrund")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (!e) {
    return (
      <div className="space-y-6">
        <h1 className="fern-page-title">Verlustgrund</h1>
        <div className="fern-card p-6 text-sm text-destructive">Einstellungen nicht lesbar (Tabelle wa_einstellungen).</div>
      </div>
    );
  }

  const gesperrt = !frei;
  const werte: Record<string, boolean> = { verlustgrund_automatisch: e.automatisch, verlustgrund_aufgabe: e.aufgabe };
  const felder = [
    { label: "Opportunity „Verlustgrund“", wert: e.verlustgrundFeld },
    { label: "Setting-Protokoll „Verlustgrund“", wert: e.settingGrundFeld },
    { label: "Closing-Protokoll „Verlustgrund“", wert: e.closingGrundFeld },
  ];
  const fehlerListe = (fehlerRes.data ?? []) as Array<{ created_at: string; error: string }>;
  const aufgabenHeute = Object.keys(e.marker).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="fern-page-title">Verlustgrund</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Woran verlieren wir Deals? Grund aus dem Protokoll übernehmen oder nachfragen.
          </p>
        </div>
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
            e.automatisch || e.aufgabe ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground",
          )}
        >
          <Tag className="size-4" />
          {e.automatisch || e.aufgabe ? "Automatik aktiv" : "Alles aus – wartet auf Freigabe"}
        </div>
      </div>

      {meldung && <p className="rounded-2xl bg-success/10 px-4 py-3 text-sm text-success">{meldung}</p>}
      {fehler && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{fehler}</p>}

      <div className="grid gap-6 lg:grid-cols-2">

        <Abschnitt
          titel="Felder in Close"
          beschreibung={`Einmalig: Auswahlfeld „${VERLUSTGRUND_FELDNAME}“ an der Opportunity sowie im Setting- und Closing-Protokoll anlegen. Mehrfaches Klicken schadet nicht (vorhandene Felder werden wiederverwendet, fehlende Gründe ergänzt).`}
        >
          <ul className="mb-4 space-y-1.5 text-sm">
            {felder.map((f) => (
              <li key={f.label} className="flex items-center gap-2">
                {f.wert ? <CheckCircle2 className="size-4 text-success" /> : <CircleAlert className="size-4 text-muted-foreground" />}
                <span>{f.label}</span>
                <code className="text-xs text-muted-foreground">{f.wert ?? "noch nicht angelegt"}</code>
              </li>
            ))}
          </ul>
          <form action={felderAnlegenAktion}>
            <Button type="submit" size="sm" variant="outline" disabled={gesperrt}>
              Felder in Close anlegen
            </Button>
          </form>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Abschnitt titel="Gründe" beschreibung="Auswahl in Close (Opportunity und Protokolle) – angelehnt an die Setting-Notizen.">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {VERLUSTGRUENDE.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ol>
        </Abschnitt>

        <Abschnitt titel="Aufgabe in Close" beschreibung="So sieht die Aufgabe aus (fällig heute).">
          <p className="rounded-xl bg-secondary px-3 py-2 text-sm">{aufgabenText("Musterfirma GmbH")}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Erinnerte Opportunities (letzte 14 Tage): {aufgabenHeute}
          </p>
          {fehlerListe.length > 0 && (
            <div className="mt-4 space-y-1">
              <p className="text-sm font-medium text-destructive">Letzte Fehler</p>
              {fehlerListe.map((f) => (
                <p key={f.created_at} className="text-xs text-muted-foreground">
                  {new Date(f.created_at).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}: {f.error.slice(0, 200)}
                </p>
              ))}
            </div>
          )}
        </Abschnitt>
      </div>
    </div>
  );
}
