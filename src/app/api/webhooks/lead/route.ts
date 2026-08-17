import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const leadSchema = z.object({
  company_id: z.string().uuid(),
  vorname: z.string().min(1),
  nachname: z.string().min(1),
  telefon: z.string().optional(),
  email: z.string().email().optional(),
  plz: z.string().optional(),
  ort: z.string().optional(),
  anliegen: z.string().optional(),
  quelle: z
    .enum(["google_ads", "onepage", "manuell", "empfehlung"])
    .optional()
    .default("manuell"),
  campaign: z.string().optional(),
});

export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret");
  if (secret !== process.env.ONEPAGE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  try {
    const raw = await request.json();
    const parsed = leadSchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 200 }
      );
    }

    const data = parsed.data;

    const { data: lead, error: insertError } = await supabase
      .from("leads")
      .insert({
        company_id: data.company_id,
        vorname: data.vorname,
        nachname: data.nachname,
        telefon: data.telefon ?? null,
        email: data.email ?? null,
        plz: data.plz ?? null,
        ort: data.ort ?? null,
        anliegen: data.anliegen ?? null,
        quelle: data.quelle,
        campaign: data.campaign ?? null,
        form_payload: null,
        status: "neu",
        assigned_to: null,
        first_contact_at: null,
        angebotswert: null,
        auftragswert: null,
        verlust_grund: null,
        naechste_aktion_am: null,
      })
      .select("id")
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true, lead_id: lead.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
