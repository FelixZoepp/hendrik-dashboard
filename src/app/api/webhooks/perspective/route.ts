import { timingSafeEqual } from "crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { funnelWebhookToken, speichereEintragung, verarbeiteFunnel } from "@/lib/funnel/automatik";

/**
 * Perspective-Funnels → Eintragung speichern, danach (after) direkt Close + PDF-Report.
 * URL: /api/webhooks/perspective?token=<Token>&funnel=<kurzname> (steht auf /sales/funnels).
 * Alles Weitere (10-Min.-Prüfung, Erinnerung) arbeitet der minütliche WhatsApp-Cron ab.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function gleich(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(request: NextRequest) {
  const erwartet = funnelWebhookToken();
  if (!erwartet) return NextResponse.json({ error: "Nicht eingerichtet" }, { status: 503 });
  if (!gleich(request.nextUrl.searchParams.get("token"), erwartet)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const roh = await request.text();
    body = roh.trim().startsWith("{") ? JSON.parse(roh) : Object.fromEntries(new URLSearchParams(roh));
  } catch {
    return NextResponse.json({ error: "Ungültiger Body" }, { status: 400 });
  }

  const svc = createAdminClient();
  try {
    const r = await speichereEintragung(svc, body, request.nextUrl.searchParams.get("funnel"));
    if ("fehler" in r) {
      await svc.from("webhook_errors").insert({ endpoint: "perspective", payload: body, error: r.fehler });
      return NextResponse.json({ error: r.fehler }, { status: 400 });
    }
    if (!r.duplicate) {
      after(() =>
        verarbeiteFunnel(svc, { deadline: Date.now() + 45_000, nurId: r.id }).catch((err) =>
          console.error("[perspective] Sofort-Verarbeitung fehlgeschlagen:", err),
        ),
      );
    }
    return NextResponse.json({ ok: true, id: r.id, duplicate: r.duplicate });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await svc.from("webhook_errors").insert({ endpoint: "perspective", payload: body, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
