import { Suspense } from "react";
import { Trash2 } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUSWAHL_KLASSE } from "@/components/zugaenge/stil";
import { ladeKontoKampagnen, metaBereit } from "@/lib/kampagne/meta";
import { aktuellerMonat, euro, monatsName, offeneKampagnen, type Zuordnung } from "@/lib/kampagne/logik";
import {
  jetztAbgleichen,
  kampagneAktivSetzen,
  kampagneEntfernen,
  kampagneZuordnen,
  manuelleKostenLoeschen,
  manuelleKostenSpeichern,
  werbekontoEntfernen,
  werbekontoSpeichern,
} from "./aktionen";
import { AktionsFormular, KampagnenAuswahl } from "./formulare";

interface ZuordnungZeile extends Zuordnung {
  id: string;
}

const fmtZeit = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Team-Bereich auf /kunden/[id]: Kampagnen der Firma zuordnen, eigenes Werbekonto,
 * manuelle Kosten, „Jetzt abgleichen“. Meta wird nur gelesen.
 */
export async function KampagnenAbschnitt({ companyId }: { companyId: string }) {
  const db = createAdminClient();
  const [zRes, kRes, mRes, sRes] = await Promise.all([
    db
      .from("kampagnen_zuordnung")
      .select("id, company_id, plattform, kampagne_id, kampagne_name, werbekonto_id, aktiv")
      .eq("company_id", companyId)
      .order("created_at"),
    db.from("kampagnen_werbekonto").select("id, werbekonto_id, aktiv").eq("company_id", companyId),
    db
      .from("manuelle_kosten")
      .select("id, monat, betrag, notiz")
      .eq("company_id", companyId)
      .order("monat", { ascending: false })
      .limit(24),
    db
      .from("kampagnen_kosten_tag")
      .select("aktualisiert_am")
      .eq("company_id", companyId)
      .order("aktualisiert_am", { ascending: false })
      .limit(1),
  ]);

  if (zRes.error) {
    return (
      <section className="fern-card p-6">
        <h2 className="text-base font-semibold">Kampagnen</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Noch nicht eingerichtet: Migration <code>00017_kampagne.sql</code> in Supabase einspielen.
        </p>
      </section>
    );
  }

  const zuordnungen = (zRes.data ?? []) as ZuordnungZeile[];
  const konten = (kRes.data ?? []) as Array<{ id: string; werbekonto_id: string; aktiv: boolean }>;
  const manuell = (mRes.data ?? []) as Array<{ id: string; monat: string; betrag: number; notiz: string | null }>;
  const letzterAbgleich = (sRes.data?.[0] as { aktualisiert_am?: string } | undefined)?.aktualisiert_am ?? null;

  return (
    <section className="fern-card space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Kampagnen</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Werbekosten dieser Firma: zugeordnete Kampagnen im zentralen Konto, ein eigenes Werbekonto oder manuelle Kosten.
            {letzterAbgleich ? ` Zuletzt abgeglichen: ${fmtZeit.format(new Date(letzterAbgleich))}.` : " Noch nicht abgeglichen."}
          </p>
        </div>
        <AktionsFormular aktion={jetztAbgleichen} companyId={companyId} knopf="Jetzt abgleichen" variante="secondary" />
      </div>

      {/* Zugeordnete Kampagnen */}
      <div>
        <h3 className="text-sm font-medium">Zugeordnet ({zuordnungen.length})</h3>
        {zuordnungen.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Noch keine Kampagne zugeordnet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {zuordnungen.map((z) => (
              <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className={z.aktiv ? "truncate text-sm font-medium" : "truncate text-sm font-medium text-muted-foreground"}>
                    {z.kampagne_name || `Kampagne ${z.kampagne_id}`}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{z.plattform === "meta" ? "Meta" : "Google"}</Badge>
                    <span className="font-mono">{z.kampagne_id}</span>
                    {z.werbekonto_id && <span>aus {z.werbekonto_id}</span>}
                    {!z.aktiv && <span>· pausiert</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <form action={kampagneAktivSetzen}>
                    <input type="hidden" name="company_id" value={companyId} />
                    <input type="hidden" name="id" value={z.id} />
                    <input type="hidden" name="aktiv" value={z.aktiv ? "0" : "1"} />
                    <Button type="submit" size="xs" variant="ghost">
                      {z.aktiv ? "Pausieren" : "Aktivieren"}
                    </Button>
                  </form>
                  <form action={kampagneEntfernen}>
                    <input type="hidden" name="company_id" value={companyId} />
                    <input type="hidden" name="id" value={z.id} />
                    <Button
                      type="submit"
                      size="xs"
                      variant="ghost"
                      title="Zuordnung und die dieser Firma zugerechneten Kosten der Kampagne entfernen"
                    >
                      <Trash2 />
                      Entfernen
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Auswahl aus dem zentralen Konto */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Kampagne aus dem zentralen Konto zuordnen</h3>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Kampagnen werden geladen …</p>}>
          <ZentraleKampagnen companyId={companyId} />
        </Suspense>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Kampagnen-ID von Hand eintragen (z. B. Google)
          </summary>
          <AktionsFormular aktion={kampagneZuordnen} companyId={companyId} knopf="Zuordnen" className="mt-2">
            <select name="plattform" className={`${AUSWAHL_KLASSE} w-28`} defaultValue="meta" aria-label="Plattform">
              <option value="meta">Meta</option>
              <option value="google">Google</option>
            </select>
            <Input name="kampagne_id" placeholder="Kampagnen-ID" inputMode="numeric" className="w-44" required />
            <Input name="kampagne_name" placeholder="Name (optional)" className="min-w-0 flex-1 basis-40" />
          </AktionsFormular>
        </details>
      </div>

      {/* Eigenes Werbekonto */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Eigenes Meta-Werbekonto (optional)</h3>
        <p className="text-xs text-muted-foreground">
          Läuft die Werbung über ein eigenes Konto der Firma, zählen alle Kampagnen darin für diese Firma. Unser Zugang
          (META_ACCESS_TOKEN) braucht Leserechte auf das Konto.
        </p>
        {konten.map((k) => (
          <div key={k.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm">
            <span className="font-mono">{k.werbekonto_id}</span>
            <form action={werbekontoEntfernen}>
              <input type="hidden" name="company_id" value={companyId} />
              <input type="hidden" name="id" value={k.id} />
              <Button type="submit" size="xs" variant="ghost">
                <Trash2 />
                Entfernen
              </Button>
            </form>
          </div>
        ))}
        <AktionsFormular aktion={werbekontoSpeichern} companyId={companyId} knopf="Hinterlegen" variante="outline">
          <Input name="werbekonto_id" placeholder="act_123456789" className="w-56 font-mono" required />
        </AktionsFormular>
      </div>

      {/* Manuelle Kosten */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Weitere Kosten je Monat</h3>
        <p className="text-xs text-muted-foreground">
          Für Werbung ohne Datenquelle (z. B. Google ohne Anbindung). Wird anteilig auf die Tage des Monats verteilt.
        </p>
        {manuell.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {manuell.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{monatsName(m.monat.slice(0, 7))}</span>: {euro(Number(m.betrag))}
                  {m.notiz && <span className="text-muted-foreground"> · {m.notiz}</span>}
                </span>
                <form action={manuelleKostenLoeschen}>
                  <input type="hidden" name="company_id" value={companyId} />
                  <input type="hidden" name="id" value={m.id} />
                  <Button type="submit" size="xs" variant="ghost" aria-label="Löschen">
                    <Trash2 />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <AktionsFormular aktion={manuelleKostenSpeichern} companyId={companyId} knopf="Speichern" variante="outline">
          <Input name="monat" type="month" defaultValue={aktuellerMonat()} className="w-44" required aria-label="Monat" />
          <Input name="betrag" placeholder="Betrag in €" inputMode="decimal" className="w-32" required aria-label="Betrag" />
          <Input name="notiz" placeholder="Notiz (z. B. Google Ads)" className="min-w-0 flex-1 basis-40" aria-label="Notiz" />
        </AktionsFormular>
      </div>
    </section>
  );
}

/** Lädt die Kampagnen des zentralen Kontos (nur lesend) und zeigt die noch freien. */
async function ZentraleKampagnen({ companyId }: { companyId: string }) {
  if (!metaBereit()) {
    return <p className="text-sm text-muted-foreground">META_ACCESS_TOKEN / META_AD_ACCOUNT_ID fehlt – ID von Hand eintragen.</p>;
  }
  const db = createAdminClient();
  let kampagnen: Awaited<ReturnType<typeof ladeKontoKampagnen>>;
  try {
    kampagnen = await ladeKontoKampagnen();
  } catch (err) {
    return (
      <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Kampagnen konnten nicht geladen werden: {err instanceof Error ? err.message : String(err)}
      </p>
    );
  }
  const { data } = await db.from("kampagnen_zuordnung").select("company_id, plattform, kampagne_id, aktiv");
  const offen = offeneKampagnen(kampagnen, (data ?? []) as Zuordnung[]);
  const offenAktiv = offen.filter((k) => k.status === "ACTIVE");

  return (
    <div className="space-y-2">
      {offen.length === 0 ? (
        <p className="text-sm text-muted-foreground">Alle Kampagnen des zentralen Kontos sind einer Firma zugeordnet.</p>
      ) : (
        <KampagnenAuswahl aktion={kampagneZuordnen} companyId={companyId} kampagnen={offen} />
      )}
      {offenAktiv.length > 0 && (
        <details className="rounded-xl bg-signal/15 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">
            {offenAktiv.length} laufende {offenAktiv.length === 1 ? "Kampagne ist" : "Kampagnen sind"} noch keiner Firma
            zugeordnet
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {offenAktiv.map((k) => (
              <li key={k.id}>
                {k.name} <span className="font-mono text-muted-foreground">{k.id}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
