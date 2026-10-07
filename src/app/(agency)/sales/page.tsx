import type { Metadata } from "next";
import { Suspense } from "react";
import { addDays, subDays } from "date-fns";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { fetchCloseTotals } from "@/lib/integrations/close";
import { getDaysFromSearchParams } from "@/lib/period-utils";
import {
  buildReport,
  type CCall,
  type CEvent,
  type CMeta,
  type COpp,
  type CSync,
  type CUser,
} from "@/lib/controlling";
import { PeriodFilter } from "@/components/ui/period-filter";
import { ControllingView } from "./controlling-view";

export const metadata: Metadata = { title: "Sales-Controlling" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = createAdminClient();
  const days = getDaysFromSearchParams(await searchParams);
  const now = new Date();
  const allTime = days >= 9999;
  const periodStart = allTime ? new Date("2000-01-01T00:00:00Z") : subDays(now, days);
  const prevStart = allTime ? null : subDays(now, days * 2);
  const loadFrom = (prevStart ?? periodStart).toISOString();

  const count = async (table: string, filter?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = supabase.from(table).select("*", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count: c } = await q;
    return c ?? null;
  };

  const [users, opps, calls, events, meta, syncsRes, leadsNew, leadsNewPrev, dbTotals, closeTotals] =
    await Promise.all([
      fetchAll<CUser>(() => supabase.from("close_users").select("close_id, name, email").order("close_id")),
      fetchAll<COpp>(() =>
        supabase
          .from("close_opportunities")
          .select("close_id, lead_id, value, status_type, status_label, confidence, user_id, date_won, date_created", { count: "exact" })
          .order("close_id")
      ),
      fetchAll<CCall>(() =>
        supabase
          .from("close_activities")
          .select("lead_id, user_id, duration, disposition, direction, date_created", { count: "exact" })
          .eq("type", "call")
          .gte("date_created", loadFrom)
          .order("close_id")
      ),
      fetchAll<CEvent>(() =>
        supabase
          .from("calendly_events")
          .select("calendly_uri, event_type_name, invitee_name, invitee_email, status, no_show, canceled_by, cancel_reason, scheduled_at, created_at, host_email, utm", { count: "exact" })
          .gte("scheduled_at", loadFrom)
          .lte("scheduled_at", addDays(now, 60).toISOString())
          .order("calendly_uri")
      ),
      fetchAll<CMeta>(() =>
        supabase
          .from("meta_ad_insights")
          .select("date, campaign_name, spend, impressions, clicks, leads", { count: "exact" })
          .gte("date", loadFrom.split("T")[0])
          .order("id")
      ),
      supabase
        .from("sync_log")
        .select("source, started_at, finished_at, status, records, error")
        .order("started_at", { ascending: false })
        .limit(30),
      count("close_leads", (q) => q.gte("date_created", periodStart.toISOString())),
      prevStart
        ? count("close_leads", (q) =>
            q.gte("date_created", prevStart.toISOString()).lt("date_created", periodStart.toISOString())
          )
        : Promise.resolve(null),
      Promise.all([
        count("close_leads"),
        count("close_opportunities"),
        count("close_opportunities", (q) => q.eq("status_type", "won")),
        count("close_activities"),
        count("calendly_events"),
      ]).then(([leads, opportunities, won, activities, ev]) => ({ leads, opportunities, won, activities, events: ev })),
      fetchCloseTotals().catch(() => null),
    ]);

  const report = buildReport({
    days,
    now,
    periodStart,
    prevStart,
    users,
    opps,
    calls,
    events,
    meta,
    leadsNew: leadsNew ?? 0,
    leadsNewPrev,
    syncs: (syncsRes.data ?? []) as CSync[],
    dbTotals,
    closeTotals,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="fern-page-title">Sales-Controlling</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {report.periodLabel} — Close, Calendly &amp; Meta Ads in einer Sicht.
          </p>
        </div>
        <Suspense>
          <PeriodFilter />
        </Suspense>
      </div>
      <ControllingView report={report} />
    </div>
  );
}
