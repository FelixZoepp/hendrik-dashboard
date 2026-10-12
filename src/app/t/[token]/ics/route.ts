import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { terminBasisUrl } from "@/lib/whatsapp/client";
import { icsDatei } from "@/lib/whatsapp/kalender";
import { ladeTerminPerToken } from "@/lib/whatsapp/termine";

export const dynamic = "force-dynamic";

/** Kalenderdatei (.ics) für Apple Kalender & Co. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const termin = await ladeTerminPerToken(createAdminClient(), token);
  if (!termin || termin.status !== "geplant") {
    return NextResponse.json({ error: "Termin nicht gefunden" }, { status: 404 });
  }
  const ics = icsDatei({
    id: termin.id,
    art: termin.art,
    start_at: termin.start_at,
    ende_at: termin.ende_at,
    ort_text: termin.ort_text,
    join_url: termin.join_url,
    seitenUrl: `${terminBasisUrl()}/t/${termin.token}`,
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="termin-hoffmann-solutions.ics"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
