import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, PartyPopper } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/lead-utils";
import {
  STUFEN,
  ZEITRAEUME,
  berechneKennzahlen,
  dauerText,
  heuteAnrufen,
  heuteEnde,
  leseZeitraum,
  zeitraumGrenzen,
  type KennzahlLead,
} from "@/lib/crm/logik";
import { KampagnenKarte } from "@/components/kampagne/kampagnen-karte";
import { HeuteAnrufenZeile, type AnrufZeile } from "./heute-anrufen";
import type { LeadStatus } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Start",
};

export const dynamic = "force-dynamic";

const MAX_ANRUFE = 15;

/** Status, die als abgeschlossen gelten (Auftrag/Verloren) – für „Heute anrufen“ ausgeschlossen. */
const ABSCHLUSS_STATUS = STUFEN.filter((s) => s.abschluss).flatMap((s) => s.status);

export default async function ClientDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireKunde();
  const sp = await searchParams;
  const zeitraum = leseZeitraum(sp.zeitraum);
  const jetzt = new Date();
  const { von, bis } = zeitraumGrenzen(zeitraum, jetzt);
  const db = createAdminClient();

  const [anrufRes, kennRes] = await Promise.all([
    db
      .from("leads")
      .select("id, vorname, nachname, ort, anliegen, telefon, status, created_at, first_contact_at, naechste_aktion_am, kontakt_versuche")
      .eq("company_id", ctx.companyId)
      .not("status", "in", `(${ABSCHLUSS_STATUS.join(",")})`)
      .or(`and(status.eq.neu,first_contact_at.is.null),naechste_aktion_am.lt.${heuteEnde(jetzt).toISOString()}`)
      .order("created_at", { ascending: true })
      .limit(200),
    db
      .from("leads")
      .select("status, created_at, first_contact_at, angebotswert, auftragswert, lead_activities(neu_status)")
      .eq("company_id", ctx.companyId)
      .eq("ist_test", false)
      .gte("created_at", von.toISOString())
      .lte("created_at", bis.toISOString())
      .eq("lead_activities.typ", "status_wechsel"),
  ]);

  const anrufe = heuteAnrufen((anrufRes.data ?? []) as AnrufZeile[], jetzt);

  type KennRow = Omit<KennzahlLead, "verlauf"> & { lead_activities: { neu_status: LeadStatus | null }[] | null };
  const k = berechneKennzahlen(
    ((kennRes.data ?? []) as unknown as KennRow[]).map((r) => ({
      ...r,
      verlauf: (r.lead_activities ?? []).map((a) => a.neu_status),
    })),
  );

  const reaktionFarbe =
    k.reaktionMinuten == null ? "" : k.reaktionMinuten < 15 ? "text-sla-gruen" : k.reaktionMinuten < 60 ? "text-sla-gelb" : "text-sla-rot";
  const prozent = (n: number | null) => (n == null ? "—" : `${n} %`);

  const kacheln: { label: string; wert: string; unten?: string; className?: string }[] = [
    { label: "Anfragen", wert: String(k.anfragen) },
    { label: "Kontaktiert", wert: prozent(k.kontaktiertQuote), unten: `${k.kontaktiert} von ${k.anfragen}` },
    { label: "Termine vor Ort", wert: String(k.termine) },
    { label: "Angebote", wert: String(k.angebote), unten: k.angeboteSumme > 0 ? formatCurrency(k.angeboteSumme) : undefined },
    {
      label: "Aufträge",
      wert: String(k.auftraege),
      unten: k.umsatz > 0 ? `${formatCurrency(k.umsatz)} Umsatz` : undefined,
      className: k.auftraege > 0 ? "text-success" : "",
    },
    { label: "Abschlussquote", wert: prozent(k.abschlussquote), unten: "Aufträge pro Anfrage" },
    {
      label: "Ø Reaktionszeit",
      wert: k.reaktionMinuten == null ? "—" : dauerText(k.reaktionMinuten),
      unten: "bis zum ersten Kontakt",
      className: reaktionFarbe,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="fern-page-title">Hallo{ctx.profile.full_name && !ctx.impersoniert ? ` ${ctx.profile.full_name.split(" ")[0]}` : ""}!</h1>
        <p className="text-sm text-muted-foreground">{ctx.company.name}</p>
      </div>

      {/* Heute anrufen */}
      <section className="fern-card space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-bold">Heute anrufen</h2>
          {anrufe.length > 0 && <span className="rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">{anrufe.length}</span>}
        </div>
        {anrufe.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-4">
            <PartyPopper className="size-6 text-success" />
            <p className="text-base">Alles erledigt – gerade muss niemand angerufen werden.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {anrufe.slice(0, MAX_ANRUFE).map((a) => (
              <HeuteAnrufenZeile key={a.id} lead={a} />
            ))}
          </ul>
        )}
        {anrufe.length > MAX_ANRUFE && (
          <Link href="/leads?stufe=offen" className="inline-block text-sm font-semibold text-primary">
            Alle {anrufe.length} ansehen →
          </Link>
        )}
      </section>

      {/* Kennzahlen */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">So läuft es</h2>
          <nav className="flex flex-wrap gap-1.5" aria-label="Zeitraum">
            {ZEITRAEUME.map((z) => (
              <Link
                key={z.value}
                href={`/dashboard?zeitraum=${z.value}`}
                scroll={false}
                className={cn(
                  "rounded-full border-2 px-4 py-2 text-sm font-semibold",
                  zeitraum === z.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
                )}
              >
                {z.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kacheln.map((t) => (
            <div key={t.label} className="fern-card p-4">
              <p className="text-sm text-muted-foreground">{t.label}</p>
              <p className={cn("mt-1 text-3xl font-bold tabular-nums", t.className)}>{t.wert}</p>
              {t.unten && <p className="mt-0.5 text-xs text-muted-foreground">{t.unten}</p>}
            </div>
          ))}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5" />
          Gezählt werden Anfragen, die im gewählten Zeitraum eingegangen sind.
        </p>
      </section>

      <KampagnenKarte companyId={ctx.companyId} von={von} bis={bis} />
    </div>
  );
}
