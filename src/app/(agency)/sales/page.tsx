import type { Metadata } from "next";
import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import { addDays } from "date-fns";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { fetchCloseTotals } from "@/lib/integrations/close";
import { getDaysFromSearchParams, getPeriod, berlinDateString, istWoche, type Period } from "@/lib/period-utils";
import {
  buildReport,
  PROTOKOLL_FILTER,
  type CCall,
  type CEvent,
  type CProtokoll,
  type CMeta,
  type COpp,
  type CSync,
  type CUser,
} from "@/lib/controlling";
import { PeriodFilter } from "@/components/ui/period-filter";
import { Skeleton } from "@/components/ui/skeleton";
import { ControllingView } from "./controlling-view";

export const metadata: Metadata = { title: "Sales-Controlling" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Gesamtzahlen direkt aus Close (Live-API, nur für den Abgleich „Datenstand“).
 * Agenturweit (ein Close-Konto, keine Firmendaten) → 5 Minuten zwischenspeichern statt bei jedem Aufruf
 * drei Close-Requests (inkl. möglicher 429-Wartezeiten) abzuwarten. Ganz fehlgeschlagen = nicht cachen.
 */
const ladeCloseTotals = unstable_cache(
  async () => {
    const t = await fetchCloseTotals();
    if (t.leads == null && t.opportunities == null && t.wonOpportunities == null) throw new Error("Close nicht erreichbar");
    return t;
  },
  ["sales-close-totals"],
  { revalidate: 300 }
);

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const days = getDaysFromSearchParams(params);
  const period = getPeriod(days, new Date(), { woche: istWoche(params) });

  // Kopf sofort ausliefern, die schwere Auswertung streamt nach
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="fern-page-title">Sales-Controlling</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {period.label} · {period.rangeLabel}
            {period.prevRangeLabel && <> · Vergleich mit {period.prevRangeLabel}</>}
          </p>
        </div>
        <Suspense>
          <PeriodFilter />
        </Suspense>
      </div>
      <Suspense fallback={<ReportSkeleton />}>
        <SalesReport period={period} />
      </Suspense>
    </div>
  );
}

async function SalesReport({ period }: { period: Period }) {
  const supabase = createAdminClient();
  const { end: now, start: periodStart, prevStart, prevEnd } = period;
  const loadFrom = (prevStart ?? periodStart).toISOString();

  const count = async (table: string, filter?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = supabase.from(table).select("*", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count: c } = await q;
    return c ?? null;
  };

  const protokollSpalten = "lead_id, user_id, custom_activity_type_id, date_created, fields";

  const [
    users,
    opps,
    calls,
    callsPrevAnzahl,
    events,
    protokolleErgebnis,
    protokolleColdCall,
    meta,
    syncsRes,
    leadsNew,
    leadsNewPrev,
    dbTotals,
    closeTotals,
  ] = await Promise.all([
    fetchAll<CUser>(() => supabase.from("close_users").select("close_id, name, email").order("close_id")),
    // Ausgewertet werden nur gewonnene und offene Opportunities
    fetchAll<COpp>(() =>
      supabase
        .from("close_opportunities")
        .select("close_id, lead_id, value, status_type, status_label, confidence, user_id, date_won, date_created", { count: "exact" })
        .in("status_type", ["won", "active"])
        .order("close_id")
    ),
    // Calls nur im Zeitraum laden; für die Vorperiode reicht die Anzahl
    fetchAll<CCall>(() =>
      supabase
        .from("close_activities")
        .select("lead_id, user_id, duration, disposition, direction, date_created", { count: "exact" })
        .eq("type", "call")
        .gte("date_created", periodStart.toISOString())
        .order("close_id")
    ),
    prevStart && prevEnd
      ? supabase
          .from("close_activities")
          .select("*", { count: "exact", head: true })
          .eq("type", "call")
          .gte("date_created", prevStart.toISOString())
          .lt("date_created", prevEnd.toISOString())
          .then(({ count: c, error }) => {
            // wie beim Laden der Calls: Fehler nicht als „0 Anrufe“ ausgeben
            if (error || c == null) throw new Error(error?.message ?? "Anzahl Calls der Vorperiode fehlt");
            return c;
          })
      : Promise.resolve(null),
    fetchAll<CEvent>(() =>
      supabase
        .from("calendly_events")
        .select("calendly_uri, event_type_name, invitee_name, invitee_email, status, no_show, canceled_by, cancel_reason, scheduled_at, created_at, host_email, utm", { count: "exact" })
        .gte("scheduled_at", loadFrom)
        .lte("scheduled_at", addDays(now, 60).toISOString())
        .order("calendly_uri")
    ),
    // Nur die Protokolle, die der Report auswertet (statt aller Cold-Call-Protokolle)
    fetchAll<CProtokoll>(() =>
      supabase
        .from("close_custom_activities")
        .select(protokollSpalten, { count: "exact" })
        .in("custom_activity_type_id", PROTOKOLL_FILTER.ergebnisTypen)
        .gte("date_created", loadFrom)
        .order("close_id")
    ),
    fetchAll<CProtokoll>(() =>
      supabase
        .from("close_custom_activities")
        .select(protokollSpalten, { count: "exact" })
        .eq("custom_activity_type_id", PROTOKOLL_FILTER.coldCallTyp)
        .eq(`fields->>"${PROTOKOLL_FILTER.coldCallFeld}"`, PROTOKOLL_FILTER.coldCallWert)
        .gte("date_created", loadFrom)
        .order("close_id")
    ),
    fetchAll<CMeta>(() =>
      supabase
        .from("meta_ad_insights")
        .select("date, campaign_name, spend, impressions, clicks, leads", { count: "exact" })
        .gte("date", berlinDateString(prevStart ?? periodStart))
        .order("id")
    ),
    supabase
      .from("sync_log")
      .select("source, started_at, finished_at, status, records, error")
      .order("started_at", { ascending: false })
      .limit(30),
    count("close_leads", (q) => q.gte("date_created", periodStart.toISOString()).lt("date_created", now.toISOString())),
    prevStart && prevEnd
      ? count("close_leads", (q) =>
          q.gte("date_created", prevStart.toISOString()).lt("date_created", prevEnd.toISOString())
        )
      : Promise.resolve(null),
    Promise.all([
      count("close_leads"),
      count("close_opportunities"),
      count("close_opportunities", (q) => q.eq("status_type", "won")),
      count("close_activities"),
      count("calendly_events"),
    ]).then(([leads, opportunities, won, activities, ev]) => ({ leads, opportunities, won, activities, events: ev })),
    ladeCloseTotals().catch(() => null),
  ]);

  // Testbuchungen des eigenen Teams (Zoepp Media, Close-Benutzer) nicht mitzählen
  const teamEmails = new Set(users.map((u) => u.email?.toLowerCase()).filter(Boolean));
  const istTest = (e: CEvent) => {
    const m = e.invitee_email?.toLowerCase() ?? "";
    return m.endsWith("@zoeppmedia.de") || teamEmails.has(m);
  };

  const report = buildReport({
    period,
    users,
    opps,
    calls,
    callsPrevAnzahl,
    events: events.filter((e) => !istTest(e)),
    protokolle: [...protokolleErgebnis, ...protokolleColdCall],
    meta,
    leadsNew: leadsNew ?? 0,
    leadsNewPrev,
    syncs: (syncsRes.data ?? []) as CSync[],
    dbTotals,
    closeTotals,
  });

  return <ControllingView report={report} />;
}

function ReportSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Auswertung wird geladen">
      {[0, 1].map((r) => (
        <div key={r} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ))}
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
