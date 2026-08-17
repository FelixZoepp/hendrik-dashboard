import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchEvents, fetchInvitees } from "@/lib/integrations/calendly";
import { subDays } from "date-fns";

export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    // Rollierendes 90-Tage-Fenster
    const minDate = subDays(new Date(), 90);

    // Aktive Events
    const activeEvents = await fetchEvents({
      minDate,
      status: "active",
    });

    // Abgesagte Events
    const canceledEvents = await fetchEvents({
      minDate,
      status: "canceled",
    });

    const allEvents = [...activeEvents, ...canceledEvents];

    for (const event of allEvents) {
      // Event-UUID aus URI extrahieren
      const eventUuid = event.uri.split("/").pop() ?? "";
      const hostEmail =
        event.event_memberships?.[0]?.user_email ?? null;

      // Invitees laden für Details (Name, E-Mail, No-Show, Absagegrund)
      let inviteeName: string | null = null;
      let inviteeEmail: string | null = null;
      let noShow = false;
      let canceledBy: string | null = null;
      let cancelReason: string | null = null;
      let utm: Record<string, string> = {};

      try {
        const invitees = await fetchInvitees(event.uri);
        if (invitees.length > 0) {
          const inv = invitees[0];
          inviteeName = inv.name;
          inviteeEmail = inv.email;
          noShow = !!inv.no_show;

          if (inv.cancellation) {
            canceledBy = inv.cancellation.canceler_type;
            cancelReason = inv.cancellation.reason ?? null;
          }

          if (inv.tracking) {
            utm = Object.fromEntries(
              Object.entries(inv.tracking).filter(
                ([, v]) => v != null && v !== ""
              )
            );
          }
        }
      } catch {
        // Invitee-Fehler ignorieren, Event trotzdem speichern
      }

      // Absagegrund aus Event-Level nutzen falls vorhanden
      if (event.cancellation && !canceledBy) {
        canceledBy = event.cancellation.canceler_type;
        cancelReason = event.cancellation.reason ?? null;
      }

      await supabase.from("calendly_events").upsert(
        {
          calendly_uri: event.uri,
          event_type_name: event.name,
          invitee_name: inviteeName,
          invitee_email: inviteeEmail,
          scheduled_at: event.start_time,
          status: event.status,
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
