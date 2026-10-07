import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchLeads,
  fetchOpportunities,
  fetchActivities,
  fetchUsers,
  fetchCustomActivities,
  fetchCustomActivityTypes,
  closeUserName,
} from "@/lib/integrations/close";
import { subDays } from "date-fns";

export const maxDuration = 300;

// Batch-Upsert Helper (max 500 pro Batch)
async function batchUpsert(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
) {
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`Upsert ${table}: ${error.message}`);
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: syncLog } = await supabase
    .from("sync_log")
    .insert({ source: "close", status: "running" })
    .select("id")
    .single();

  const syncId = syncLog?.id;
  let totalRecords = 0;

  try {
    // Delta: Start des letzten erfolgreichen Syncs (minus 1h Puffer), sonst 90 Tage.
    // ?full=1 erzwingt einen kompletten Abgleich der letzten 365 Tage.
    const full = new URL(request.url).searchParams.get("full") === "1";
    const { data: lastSync } = await supabase
      .from("sync_log")
      .select("started_at")
      .eq("source", "close")
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    const since = full
      ? subDays(new Date(), 365)
      : lastSync?.started_at
        ? new Date(new Date(lastSync.started_at).getTime() - 3600_000)
        : subDays(new Date(), 90);

    // 1. Users
    const users = await fetchUsers();
    await batchUpsert(
      supabase,
      "close_users",
      users.map((u) => ({
        close_id: u.id,
        name: closeUserName(u),
        email: u.email,
      })),
      "close_id"
    );
    totalRecords += users.length;

    // 2. Leads
    const leads = await fetchLeads(since);
    await batchUpsert(
      supabase,
      "close_leads",
      leads.map((l) => ({
        close_id: l.id,
        name: l.display_name,
        status_label: l.status_label,
        status_type: l.status_type,
        date_created: l.date_created,
        date_updated: l.date_updated,
        lead_source: l.lead_source ?? null,
        assigned_user: l.assigned_to ?? null,
        custom_fields: {
          ...(l.custom ?? {}),
          // Kontakt-E-Mails für die Zuordnung Calendly-Termin → Lead → Setter
          _contact_emails: (l.contacts ?? [])
            .flatMap((c) => c.emails ?? [])
            .map((e) => e.email.toLowerCase()),
        },
      })),
      "close_id"
    );
    totalRecords += leads.length;

    // 3. Opportunities — immer komplett, damit Statuswechsel (gewonnen/verloren) ankommen
    const opps = await fetchOpportunities();
    await batchUpsert(
      supabase,
      "close_opportunities",
      opps.map((o) => ({
        close_id: o.id,
        lead_id: o.lead_id,
        value: o.value / 100,
        value_period: o.value_period,
        status_label: o.status_label,
        status_type: o.status_type,
        confidence: o.confidence,
        date_won: o.date_won ?? null,
        user_id: o.user_id,
        date_created: o.date_created,
      })),
      "close_id"
    );
    totalRecords += opps.length;

    // 4. Activities
    // Activities ändern sich nachträglich kaum — im Full-Modus reicht eine Woche
    const activities = await fetchActivities(full ? subDays(new Date(), 7) : since);
    await batchUpsert(
      supabase,
      "close_activities",
      activities.map((a) => ({
        close_id: a.id,
        lead_id: a.lead_id,
        type: a._type.toLowerCase().replace("activity", ""),
        direction: a.direction ?? null,
        duration: a.duration ?? null,
        user_id: a.user_id,
        date_created: a.date_created,
        disposition: a.disposition ?? null,
      })),
      "close_id"
    );
    totalRecords += activities.length;

    // 5. Custom Activities
    const customTypes = await fetchCustomActivityTypes();
    const typeMap = new Map(customTypes.map((t) => [t.id, t.name]));

    const customActs = await fetchCustomActivities(since);
    await batchUpsert(
      supabase,
      "close_custom_activities",
      customActs.map((ca) => ({
        close_id: ca.id,
        lead_id: ca.lead_id,
        custom_activity_type_id: ca.custom_activity_type_id,
        custom_activity_type_name: typeMap.get(ca.custom_activity_type_id) ?? "Unbekannt",
        user_id: ca.user_id,
        date_created: ca.date_created,
        fields: ca.fields ?? {},
      })),
      "close_id"
    );
    totalRecords += customActs.length;

    if (syncId) {
      await supabase
        .from("sync_log")
        .update({
          finished_at: new Date().toISOString(),
          records: totalRecords,
          status: "success",
        })
        .eq("id", syncId);
    }

    return NextResponse.json({ ok: true, records: totalRecords, full, since: since.toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (syncId) {
      await supabase
        .from("sync_log")
        .update({
          finished_at: new Date().toISOString(),
          status: "error",
          error: message,
        })
        .eq("id", syncId);
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
