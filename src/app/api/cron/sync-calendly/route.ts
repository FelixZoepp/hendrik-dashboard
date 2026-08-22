import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { subDays } from "date-fns";

export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.CALENDLY_TOKEN || process.env.CALENDLY_API_KEY;
  if (!token) {
    return NextResponse.json({ error: "No Calendly token" }, { status: 500 });
  }

  const supabase = createAdminClient();
  const { data: syncLog } = await supabase
    .from("sync_log")
    .insert({ source: "calendly", status: "running" })
    .select("id")
    .single();
  const syncId = syncLog?.id;
  let totalRecords = 0;

  try {
    // 1. Get org URI
    const meRes = await fetch("https://api.calendly.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meData = await meRes.json();
    const orgUri = meData.resource?.current_organization;
    if (!orgUri) throw new Error("Could not get org URI");

    // 2. Fetch all events (active + canceled) from last 90 days
    const minDate = subDays(new Date(), 90).toISOString();
    const allEvents: Record<string, unknown>[] = [];

    for (const status of ["active", "canceled"]) {
      let nextPageToken: string | null = null;
      let isFirst = true;

      while (isFirst || nextPageToken) {
        isFirst = false;
        const url = new URL("https://api.calendly.com/scheduled_events");
        url.searchParams.set("organization", orgUri);
        url.searchParams.set("count", "100");
        url.searchParams.set("status", status);
        url.searchParams.set("min_start_time", minDate);
        if (nextPageToken) {
          url.searchParams.set("page_token", nextPageToken);
        }

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Calendly ${res.status}: ${body}`);
        }

        const data = await res.json();
        allEvents.push(...(data.collection ?? []));
        nextPageToken = data.pagination?.next_page_token ?? null;
      }
    }

    // 3. Upsert events
    for (const event of allEvents) {
      const uri = event.uri as string;
      const hostEmail =
        (event.event_memberships as Array<{ user_email: string }>)?.[0]
          ?.user_email ?? null;
      const cancellation = event.cancellation as {
        canceled_by?: string;
        reason?: string;
        canceler_type?: string;
      } | undefined;

      // Invitees laden (für Name, Email, No-Show)
      let inviteeName: string | null = null;
      let inviteeEmail: string | null = null;
      let noShow = false;
      let canceledBy: string | null = cancellation?.canceler_type ?? null;
      let cancelReason: string | null = cancellation?.reason ?? null;
      let utm: Record<string, string> = {};

      try {
        const uuid = uri.split("/").pop();
        const invRes = await fetch(
          `https://api.calendly.com/scheduled_events/${uuid}/invitees?count=1`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (invRes.ok) {
          const invData = await invRes.json();
          const inv = invData.collection?.[0];
          if (inv) {
            inviteeName = inv.name ?? null;
            inviteeEmail = inv.email ?? null;
            noShow = !!inv.no_show;
            if (inv.cancellation) {
              canceledBy = inv.cancellation.canceler_type ?? canceledBy;
              cancelReason = inv.cancellation.reason ?? cancelReason;
            }
            if (inv.tracking) {
              utm = Object.fromEntries(
                Object.entries(inv.tracking as Record<string, unknown>).filter(
                  ([, v]) => v != null && v !== ""
                )
              ) as Record<string, string>;
            }
          }
        }
      } catch {
        // Invitee-Fehler ignorieren
      }

      await supabase.from("calendly_events").upsert(
        {
          calendly_uri: uri,
          event_type_name: (event.name as string) ?? null,
          invitee_name: inviteeName,
          invitee_email: inviteeEmail,
          scheduled_at: event.start_time as string,
          status: event.status as string,
          canceled_by: canceledBy,
          cancel_reason: cancelReason,
          no_show: noShow,
          host_email: hostEmail,
          utm,
        },
        { onConflict: "calendly_uri" }
      );
      totalRecords++;
    }

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
