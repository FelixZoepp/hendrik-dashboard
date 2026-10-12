import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ladeTerminPerToken } from "@/lib/whatsapp/termine";

export const dynamic = "force-dynamic";

/** Knopf „Gespräch beitreten“ → Meeting-Link des Termins, sonst die Termin-Seite. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const termin = await ladeTerminPerToken(createAdminClient(), token);
  const ziel =
    termin?.join_url && /^https:\/\//.test(termin.join_url)
      ? termin.join_url
      : new URL(`/t/${encodeURIComponent(token)}`, request.url).toString();
  return NextResponse.redirect(ziel, { status: 302, headers: { "X-Robots-Tag": "noindex" } });
}
