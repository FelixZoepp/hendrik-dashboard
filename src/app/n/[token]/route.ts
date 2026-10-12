import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ladeEinstellungen } from "@/lib/whatsapp/einstellungen";
import { ladeTerminPerToken } from "@/lib/whatsapp/termine";

export const dynamic = "force-dynamic";

/** Knopf „Neuen Termin wählen“ → Buchungslink der Terminart (Einstellungen), sonst die Termin-Seite. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const svc = createAdminClient();
  const termin = await ladeTerminPerToken(svc, token);
  const link = termin ? (await ladeEinstellungen(svc)).buchungslinks[termin.art] : null;
  const ziel = link ?? new URL(`/t/${encodeURIComponent(token)}`, request.url).toString();
  return NextResponse.redirect(ziel, { status: 302, headers: { "X-Robots-Tag": "noindex" } });
}
