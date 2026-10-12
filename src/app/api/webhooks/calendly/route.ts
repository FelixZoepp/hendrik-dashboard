import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verarbeiteCalendly, type CalendlyWebhook } from "@/lib/whatsapp/quellen";

// Calendly-Webhook (invitee.created / invitee.canceled) → Termine für den WhatsApp-Terminbot.
// Signatur: Header "Calendly-Webhook-Signature: t=<unix>,v1=<hex>", HMAC-SHA256 über `${t}.${rawBody}`.

export const maxDuration = 60;

const MAX_ALTER_S = 300;

function pruefeSignatur(body: string, header: string | null, key: string): boolean {
  if (!header) return false;
  const teile: Record<string, string> = {};
  for (const teil of header.split(",")) {
    const i = teil.indexOf("=");
    if (i > 0) teile[teil.slice(0, i).trim()] = teil.slice(i + 1).trim();
  }
  const t = teile.t;
  const v1 = teile.v1;
  if (!t || !v1) return false;
  const alter = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(alter) || alter > MAX_ALTER_S) return false;
  const erwartet = Buffer.from(createHmac("sha256", key).update(`${t}.${body}`).digest("hex"));
  const erhalten = Buffer.from(v1);
  return erwartet.length === erhalten.length && timingSafeEqual(erwartet, erhalten);
}

export async function POST(request: Request) {
  const body = await request.text();
  const supabase = createAdminClient();
  const logFehler = (payload: Record<string, unknown>, error: string) =>
    supabase.from("webhook_errors").insert({ endpoint: "calendly", payload, error });

  const key = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!key) {
    await logFehler({}, "CALENDLY_WEBHOOK_SIGNING_KEY fehlt");
    return NextResponse.json({ error: "Webhook nicht konfiguriert" }, { status: 503 });
  }
  if (!pruefeSignatur(body, request.headers.get("calendly-webhook-signature"), key)) {
    await logFehler({ body: body.slice(0, 500) }, "Ungültige Signatur");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let daten: CalendlyWebhook;
  try {
    daten = JSON.parse(body) as CalendlyWebhook;
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON" }, { status: 400 });
  }

  try {
    const ergebnis = await verarbeiteCalendly(supabase, daten);
    return NextResponse.json({ ok: true, ...ergebnis });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logFehler(
      { event: daten.event, scheduled_event: daten.payload?.scheduled_event?.uri ?? null },
      message,
    );
    // 500 → Calendly stellt erneut zu; die Verarbeitung ist idempotent (calendly_event_uri)
    return NextResponse.json({ error: "Verarbeitung fehlgeschlagen" }, { status: 500 });
  }
}
