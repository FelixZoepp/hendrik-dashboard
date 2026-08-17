import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyNewLead } from "@/lib/notifications";
import type { LeadQuelle } from "@/lib/types/database";

export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret");
  if (secret !== process.env.ONEPAGE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  try {
    const raw = await request.json();

    // Normalize payload — OnePage sends flat form fields
    const vorname = String(raw.vorname ?? raw.first_name ?? "").trim();
    const nachname = String(raw.nachname ?? raw.last_name ?? "").trim();
    const telefon = String(raw.telefon ?? raw.phone ?? raw.tel ?? "").trim() || null;
    const email = String(raw.email ?? raw.mail ?? "").trim() || null;
    const plz = String(raw.plz ?? raw.zip ?? raw.postleitzahl ?? "").trim() || null;
    const ort = String(raw.ort ?? raw.city ?? raw.stadt ?? "").trim() || null;
    const anliegen = String(raw.anliegen ?? raw.message ?? raw.nachricht ?? "").trim() || null;
    const formId = String(raw.form_id ?? raw.formId ?? "").trim();

    // UTM params
    const campaign = String(
      raw.utm_campaign ?? raw.campaign ?? ""
    ).trim() || null;

    // Look up company via form mapping
    const { data: mapping, error: mappingError } = await supabase
      .from("company_form_mappings")
      .select("company_id, campaign")
      .eq("form_id", formId)
      .single();

    if (mappingError || !mapping) {
      await supabase.from("webhook_errors").insert({
        endpoint: "onepage",
        payload: raw,
        error: `No company_form_mapping found for form_id: ${formId}`,
      });
      return NextResponse.json({ ok: true });
    }

    const { error: insertError } = await supabase.from("leads").insert({
      company_id: mapping.company_id,
      vorname,
      nachname,
      telefon,
      email,
      plz,
      ort,
      anliegen,
      quelle: "onepage" as LeadQuelle,
      campaign: campaign ?? mapping.campaign ?? null,
      form_payload: raw,
      status: "neu",
      assigned_to: null,
      first_contact_at: null,
      angebotswert: null,
      auftragswert: null,
      verlust_grund: null,
      naechste_aktion_am: null,
    });

    if (insertError) {
      await supabase.from("webhook_errors").insert({
        endpoint: "onepage",
        payload: raw,
        error: insertError.message,
      });
    } else {
      // Notify client owners about the new lead
      try {
        const { data: owners } = await supabase
          .from("profiles")
          .select("id")
          .eq("company_id", mapping.company_id)
          .in("role", ["client_owner"]);

        // Supabase Auth: get emails from auth.users via admin API
        const ownerEmails: string[] = [];
        if (owners && owners.length > 0) {
          for (const owner of owners) {
            const { data: authUser } =
              await supabase.auth.admin.getUserById(owner.id);
            if (authUser?.user?.email) {
              ownerEmails.push(authUser.user.email);
            }
          }
        }

        // Look up company name for the email
        const { data: company } = await supabase
          .from("companies")
          .select("name")
          .eq("id", mapping.company_id)
          .single();

        if (ownerEmails.length > 0) {
          await notifyNewLead({
            to: ownerEmails,
            leadName: `${vorname} ${nachname}`.trim(),
            anliegen,
            ort,
            companyName: company?.name ?? "Unbekannt",
          });
        }
      } catch {
        // Notification failure must not break the webhook
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await supabase.from("webhook_errors").insert({
      endpoint: "onepage",
      payload: null,
      error: message,
    });
    return NextResponse.json({ ok: true });
  }
}
