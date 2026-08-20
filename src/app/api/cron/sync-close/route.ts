import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchLeads,
  fetchOpportunities,
  fetchActivities,
  fetchUsers,
  fetchCustomActivities,
  fetchCustomActivityTypes,
} from "@/lib/integrations/close";

export const maxDuration = 300; // 5 Min. max

export async function GET(request: Request) {
  // CRON_SECRET prüfen
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Sync-Log starten
  const { data: syncLog } = await supabase
    .from("sync_log")
    .insert({ source: "close", status: "running" })
    .select("id")
    .single();

  const syncId = syncLog?.id;
  let totalRecords = 0;

  try {
    // Letzten erfolgreichen Sync finden für Delta
    const { data: lastSync } = await supabase
      .from("sync_log")
      .select("finished_at")
      .eq("source", "close")
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .single();

    const since = lastSync?.finished_at
      ? new Date(lastSync.finished_at)
      : undefined;

    // 1. Users syncen
    const users = await fetchUsers();
    for (const user of users) {
      await supabase.from("close_users").upsert(
        {
          close_id: user.id,
          name: `${user.first_name} ${user.last_name}`.trim(),
          email: user.email,
        },
        { onConflict: "close_id" }
      );
    }
    totalRecords += users.length;

    // 2. Leads syncen
    const leads = await fetchLeads(since);
    for (const lead of leads) {
      await supabase.from("close_leads").upsert(
        {
          close_id: lead.id,
          name: lead.display_name,
          status_label: lead.status_label,
          status_type: lead.status_type,
          date_created: lead.date_created,
          date_updated: lead.date_updated,
          lead_source: lead.lead_source ?? null,
          assigned_user: lead.assigned_to ?? null,
          custom_fields: lead.custom ?? {},
        },
        { onConflict: "close_id" }
      );
    }
    totalRecords += leads.length;

    // 3. Opportunities syncen
    const opportunities = await fetchOpportunities(since);
    for (const opp of opportunities) {
      await supabase.from("close_opportunities").upsert(
        {
          close_id: opp.id,
          lead_id: opp.lead_id,
          value: opp.value / 100, // Close speichert in Cents
          value_period: opp.value_period,
          status_label: opp.status_label,
          status_type: opp.status_type,
          confidence: opp.confidence,
          date_won: opp.date_won ?? null,
          user_id: opp.user_id,
          date_created: opp.date_created,
        },
        { onConflict: "close_id" }
      );
    }
    totalRecords += opportunities.length;

    // 4. Activities syncen
    const activities = await fetchActivities(since);
    for (const act of activities) {
      await supabase.from("close_activities").upsert(
        {
          close_id: act.id,
          lead_id: act.lead_id,
          type: act._type.toLowerCase().replace("activity", ""),
          direction: act.direction ?? null,
          duration: act.duration ?? null,
          user_id: act.user_id,
          date_created: act.date_created,
          disposition: act.disposition ?? null,
        },
        { onConflict: "close_id" }
      );
    }
    totalRecords += activities.length;

    // 5. Custom Activities syncen (Gesprächsprotokoll etc.)
    const customActivityTypes = await fetchCustomActivityTypes();
    const typeNameMap = new Map(customActivityTypes.map((t) => [t.id, t.name]));

    const customActivities = await fetchCustomActivities(since);
    for (const ca of customActivities) {
      await supabase.from("close_custom_activities").upsert(
        {
          close_id: ca.id,
          lead_id: ca.lead_id,
          custom_activity_type_id: ca.custom_activity_type_id,
          custom_activity_type_name:
            typeNameMap.get(ca.custom_activity_type_id) ?? "Unbekannt",
          user_id: ca.user_id,
          date_created: ca.date_created,
          fields: ca.fields ?? {},
        },
        { onConflict: "close_id" }
      );
    }
    totalRecords += customActivities.length;

    // Sync-Log abschließen
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

    return NextResponse.json({
      ok: true,
      records: totalRecords,
      delta: !!since,
    });
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
