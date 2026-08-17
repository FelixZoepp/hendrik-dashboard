import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyLeadReminder, notifyLeadEscalation } from "@/lib/notifications";

export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  let reminders = 0;
  let escalations = 0;

  try {
    // Query leads that are still "neu" and have never been contacted
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, vorname, nachname, company_id, created_at")
      .eq("status", "neu")
      .is("first_contact_at", null);

    if (leadsError || !leads) {
      return NextResponse.json(
        { ok: false, error: leadsError?.message ?? "No leads found" },
        { status: 500 }
      );
    }

    for (const lead of leads) {
      const createdAt = new Date(lead.created_at);
      const minutesSinceCreation = Math.floor(
        (now.getTime() - createdAt.getTime()) / 60_000
      );

      if (minutesSinceCreation < 15) continue;

      // Get company name
      const { data: company } = await supabase
        .from("companies")
        .select("name")
        .eq("id", lead.company_id)
        .single();

      const companyName = company?.name ?? "Unbekannt";
      const leadName = `${lead.vorname} ${lead.nachname}`.trim();

      // Get client_owner emails for this company
      const ownerEmails = await getOwnerEmails(supabase, lead.company_id);

      if (minutesSinceCreation >= 60) {
        // Escalation: 60+ minutes
        // Check if escalation was already sent
        const alreadySent = await hasReminderActivity(
          supabase,
          lead.id,
          "Eskalation"
        );
        if (alreadySent) continue;

        // Escalation goes to client owners + Hoffman email
        const hoffmanEmail = process.env.HOFFMAN_EMAIL ?? "";
        const escalationRecipients = [...ownerEmails];
        if (hoffmanEmail) {
          escalationRecipients.push(hoffmanEmail);
        }

        if (escalationRecipients.length > 0) {
          await notifyLeadEscalation({
            to: escalationRecipients,
            leadName,
            minutesSinceCreation,
            companyName,
          });
          escalations++;
        }

        // Mark as sent
        await supabase.from("lead_activities").insert({
          lead_id: lead.id,
          typ: "email" as const,
          inhalt: `Eskalation: Lead seit ${minutesSinceCreation} Min. ohne Kontakt`,
        });
      } else {
        // Reminder: 15-59 minutes
        // Check if reminder was already sent
        const alreadySent = await hasReminderActivity(
          supabase,
          lead.id,
          "Erinnerung"
        );
        if (alreadySent) continue;

        if (ownerEmails.length > 0) {
          await notifyLeadReminder({
            to: ownerEmails,
            leadName,
            minutesSinceCreation,
            companyName,
          });
          reminders++;
        }

        // Mark as sent
        await supabase.from("lead_activities").insert({
          lead_id: lead.id,
          typ: "email" as const,
          inhalt: `Erinnerung: Lead seit ${minutesSinceCreation} Min. ohne Kontakt`,
        });
      }
    }

    return NextResponse.json({ ok: true, reminders, escalations });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function getOwnerEmails(
  supabase: ReturnType<typeof createAdminClient>,
  companyId: string
): Promise<string[]> {
  const { data: owners } = await supabase
    .from("profiles")
    .select("id")
    .eq("company_id", companyId)
    .in("role", ["client_owner"]);

  if (!owners || owners.length === 0) return [];

  const emails: string[] = [];
  for (const owner of owners) {
    const { data: authUser } =
      await supabase.auth.admin.getUserById(owner.id);
    if (authUser?.user?.email) {
      emails.push(authUser.user.email);
    }
  }
  return emails;
}

async function hasReminderActivity(
  supabase: ReturnType<typeof createAdminClient>,
  leadId: string,
  keyword: string
): Promise<boolean> {
  const { data } = await supabase
    .from("lead_activities")
    .select("id")
    .eq("lead_id", leadId)
    .eq("typ", "email")
    .ilike("inhalt", `%${keyword}%`)
    .limit(1);

  return (data?.length ?? 0) > 0;
}
