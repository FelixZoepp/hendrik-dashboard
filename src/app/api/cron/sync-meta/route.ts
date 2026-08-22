import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAdInsights } from "@/lib/integrations/meta";

export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: syncLog } = await supabase
    .from("sync_log")
    .insert({ source: "meta", status: "running" })
    .select("id")
    .single();

  const syncId = syncLog?.id;
  let totalRecords = 0;

  try {
    // Letzten Sync finden, sonst 90 Tage
    const { data: lastSync } = await supabase
      .from("sync_log")
      .select("finished_at")
      .eq("source", "meta")
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .single();

    const since = lastSync?.finished_at
      ? lastSync.finished_at.split("T")[0]
      : undefined; // fetchAdInsights defaults to 90 days

    const insights = await fetchAdInsights(since ? { since } : undefined);

    // Batch upsert
    const BATCH_SIZE = 500;
    const rows = insights.map((i) => {
      const leads =
        i.actions?.find((a) => a.action_type === "lead")?.value ?? "0";

      return {
        date: i.date_start,
        campaign_id: i.campaign_id,
        campaign_name: i.campaign_name,
        adset_name: i.adset_name ?? null,
        ad_name: i.ad_name ?? null,
        spend: parseFloat(i.spend) || 0,
        impressions: parseInt(i.impressions) || 0,
        clicks: parseInt(i.clicks) || 0,
        ctr: parseFloat(i.ctr) || 0,
        cpc: parseFloat(i.cpc) || 0,
        leads: parseInt(leads) || 0,
        cost_per_lead:
          parseInt(leads) > 0
            ? (parseFloat(i.spend) || 0) / parseInt(leads)
            : 0,
      };
    });

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await supabase
        .from("meta_ad_insights")
        .upsert(batch, { onConflict: "date,campaign_id,adset_name,ad_name" });
    }

    totalRecords = rows.length;

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

    return NextResponse.json({ ok: true, records: totalRecords });
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
