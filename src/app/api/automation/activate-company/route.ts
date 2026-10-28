import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { firmaAktivieren } from "@/lib/firma-aktivieren";

export async function POST(request: Request) {
  // CRON_SECRET prüfen (gleicher Pattern wie Cron-Routes)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const companyId = body.company_id;

  if (!companyId || typeof companyId !== "string") {
    return NextResponse.json({ error: "company_id is required" }, { status: 400 });
  }

  const ergebnis = await firmaAktivieren(createAdminClient(), companyId);
  if (!ergebnis.ok) return NextResponse.json({ error: ergebnis.fehler }, { status: 500 });
  return NextResponse.json({ ok: true, projects_created: ergebnis.projekteAngelegt });
}
