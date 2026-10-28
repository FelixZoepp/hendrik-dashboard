import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gleichSicher } from "@/lib/eingang/logik";
import { syncKampagnenMitLog } from "@/lib/kampagne/sync";

export const maxDuration = 300;

/** Täglich: Werbekosten der letzten 30 Tage je zugeordneter Kampagne → kampagnen_kosten_tag. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Nicht eingerichtet" }, { status: 503 });
  if (!gleichSicher(request.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const e = await syncKampagnenMitLog(createAdminClient());
    const status = e.fehler.length > 0 && e.zeilen === 0 ? 500 : 200;
    return NextResponse.json({ ok: e.fehler.length === 0, ...e }, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
