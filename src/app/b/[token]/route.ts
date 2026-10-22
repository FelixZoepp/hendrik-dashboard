import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { eintragungPerToken } from "@/lib/funnel/automatik";
import { ladeFunnelEinstellungen } from "@/lib/funnel/einstellungen";
import { buchungsUrl } from "@/lib/funnel/logik";
import { ladeEinstellungen } from "@/lib/whatsapp/einstellungen";

export const dynamic = "force-dynamic";

/** Knopf „Termin auswählen“/„Erstgespräch buchen“ (Funnel-WhatsApp) → Buchungslink mit Name/E-Mail vorbelegt. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const svc = createAdminClient();
  const e = await eintragungPerToken(svc, token).catch(() => null);
  const funnel = e ? (await ladeFunnelEinstellungen(svc).catch(() => null))?.funnels[e.funnel] : null;
  const basis = funnel?.buchungslink ?? (await ladeEinstellungen(svc).catch(() => null))?.buchungslinks.erstgespraech ?? null;
  const ziel = basis && e ? buchungsUrl(basis, e) : (basis ?? new URL("/", request.url).toString());
  return NextResponse.redirect(ziel, { status: 302, headers: { "X-Robots-Tag": "noindex" } });
}
