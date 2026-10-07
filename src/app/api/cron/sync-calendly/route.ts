import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, subDays } from "date-fns";

export const maxDuration = 300;

const API = "https://api.calendly.com";
const INVITEE_CONCURRENCY = 8;

type CalendlyEvent = {
  uri: string;
  name?: string;
  status: string;
  start_time: string;
  created_at?: string;
  event_memberships?: Array<{ user_email?: string }>;
  cancellation?: { canceler_type?: string; reason?: string };
};

async function calendly<T>(url: string, token: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Calendly ${res.status} on ${url}: ${await res.text()}`);
    return (await res.json()) as T;
  }
}

/**
 * Setter-Zuordnung: Invitee-E-Mail → Close-Lead (Kontakt-E-Mails aus dem Close-Sync)
 * → letzter Anruf auf diesem Lead vor der Buchung → Close-User = Setter.
 * Wird in `utm` unter `_close_lead_id` / `_setter_user_id` abgelegt (eigene Spalten
 * bräuchten eine Migration; die Unterstrich-Keys sind keine echten UTM-Parameter).
 */
async function attributeSetter(
  supabase: ReturnType<typeof createAdminClient>,
  email: string | null,
  bookedAt: string
): Promise<Record<string, string>> {
  if (!email) return {};
  const { data: leads } = await supabase
    .from("close_leads")
    .select("close_id")
    .contains("custom_fields", { _contact_emails: [email] })
    .limit(1);
  const leadId = leads?.[0]?.close_id as string | undefined;
  if (!leadId) return {};
  const { data: calls } = await supabase
    .from("close_activities")
    .select("user_id")
    .eq("lead_id", leadId)
    .eq("type", "call")
    .lte("date_created", bookedAt)
    .order("date_created", { ascending: false })
    .limit(1);
  const setter = calls?.[0]?.user_id as string | undefined;
  const out: Record<string, string> = { _close_lead_id: leadId };
  if (setter) out._setter_user_id = setter;
  return out;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const envToken = process.env.CALENDLY_TOKEN || process.env.CALENDLY_API_KEY;
  if (!envToken) {
    return NextResponse.json({ error: "No Calendly token" }, { status: 500 });
  }
  const token: string = envToken;

  const supabase = createAdminClient();
  const { data: syncLog } = await supabase
    .from("sync_log")
    .insert({ source: "calendly", status: "running" })
    .select("id")
    .single();
  const syncId = syncLog?.id;

  try {
    const me = await calendly<{ resource?: { current_organization?: string } }>(
      `${API}/users/me`,
      token
    );
    const orgUri = me.resource?.current_organization;
    if (!orgUri) throw new Error("Could not get org URI");

    // Fenster: 120 Tage zurück (No-Show-Markierungen kommen nachträglich)
    // bis 60 Tage voraus (bereits gebuchte, kommende Termine). ?full=1 → 365 Tage.
    const full = new URL(request.url).searchParams.get("full") === "1";
    const minStart = subDays(new Date(), full ? 365 : 120).toISOString();
    const maxStart = addDays(new Date(), 60).toISOString();

    const events: CalendlyEvent[] = [];
    for (const status of ["active", "canceled"]) {
      const url = new URL(`${API}/scheduled_events`);
      url.searchParams.set("organization", orgUri);
      url.searchParams.set("count", "100");
      url.searchParams.set("status", status);
      url.searchParams.set("min_start_time", minStart);
      url.searchParams.set("max_start_time", maxStart);
      let next: string | null = url.toString();
      while (next) {
        const page: {
          collection?: CalendlyEvent[];
          pagination?: { next_page?: string | null };
        } = await calendly(next, token);
        events.push(...(page.collection ?? []));
        next = page.pagination?.next_page ?? null;
      }
    }

    // Invitees parallel (begrenzt) laden
    const rows: Record<string, unknown>[] = new Array(events.length);
    let cursor = 0;
    async function worker() {
      while (cursor < events.length) {
        const i = cursor++;
        const event = events[i];
        let inviteeName: string | null = null;
        let inviteeEmail: string | null = null;
        let noShow = false;
        let canceledBy: string | null = event.cancellation?.canceler_type ?? null;
        let cancelReason: string | null = event.cancellation?.reason ?? null;
        let utm: Record<string, string> = {};
        try {
          const uuid = event.uri.split("/").pop();
          const inv = await calendly<{
            collection?: Array<{
              name?: string;
              email?: string;
              no_show?: unknown;
              cancellation?: { canceler_type?: string; reason?: string };
              tracking?: Record<string, unknown>;
            }>;
          }>(`${API}/scheduled_events/${uuid}/invitees?count=1`, token);
          const first = inv.collection?.[0];
          if (first) {
            inviteeName = first.name ?? null;
            inviteeEmail = first.email?.toLowerCase() ?? null;
            noShow = !!first.no_show;
            if (first.cancellation) {
              canceledBy = first.cancellation.canceler_type ?? canceledBy;
              cancelReason = first.cancellation.reason ?? cancelReason;
            }
            if (first.tracking) {
              utm = Object.fromEntries(
                Object.entries(first.tracking).filter(([, v]) => v != null && v !== "")
              ) as Record<string, string>;
            }
          }
        } catch {
          // Invitee-Fehler: Event trotzdem speichern
        }
        const bookedAt = event.created_at ?? new Date().toISOString();
        try {
          Object.assign(utm, await attributeSetter(supabase, inviteeEmail, bookedAt));
        } catch {
          // Zuordnung ist optional
        }
        rows[i] = {
          calendly_uri: event.uri,
          event_type_name: event.name ?? null,
          invitee_name: inviteeName,
          invitee_email: inviteeEmail,
          scheduled_at: event.start_time,
          // Buchungszeitpunkt (nicht Sync-Zeitpunkt)
          created_at: bookedAt,
          status: event.status,
          canceled_by: canceledBy,
          cancel_reason: cancelReason,
          no_show: noShow,
          host_email: event.event_memberships?.[0]?.user_email ?? null,
          utm,
        };
      }
    }
    await Promise.all(Array.from({ length: INVITEE_CONCURRENCY }, worker));

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from("calendly_events")
        .upsert(rows.slice(i, i + 500), { onConflict: "calendly_uri" });
      if (error) throw new Error(`Upsert calendly_events: ${error.message}`);
    }

    if (syncId) {
      await supabase
        .from("sync_log")
        .update({
          finished_at: new Date().toISOString(),
          records: rows.length,
          status: "success",
        })
        .eq("id", syncId);
    }

    return NextResponse.json({ ok: true, records: rows.length, minStart, maxStart });
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
