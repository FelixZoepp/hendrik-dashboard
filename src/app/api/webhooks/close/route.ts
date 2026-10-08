import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { closeApi } from "@/lib/integrations/close";
import { createAdminClient } from "@/lib/supabase/admin";

// Close-Webhook: Gesprächsprotokolle → Opportunity-Status in der
// Pipeline "Setter-Closer Hoffmann Solutions" automatisch nachziehen.

const SETTING_PROTOKOLL_TYPE = "actitype_41UXYctoK8pqnPD2TvTGoO";
const SETTING_NAECHSTER_SCHRITT = "custom.cf_6Kt9RVMkQiuDOXBiiTRrKg8DTwvoQn8EEBCXmaTykGZ";
const CLOSING_GELEGT = "Closing gelegt am:";

const STATUS = {
  settingTerminiert: "stat_4p97QFLGWcJTiOLz4s1bYtWKBVQR50XaQpHUdfhe8UC",
  settingNoShow: "stat_pGAeTxZ2rkNIzksWsLHKoHJdllKUCWUuqLs4dH9edNZ",
  settingFollowUp: "stat_S4XYNlf3MhHEKnvjbiCeUYJg52iX6dFWkaWuUoFg8xE",
  closingTerminiert: "stat_KSyJfnSIxwTUu4e9gJhhjoI7zn6b2pTALKpD4MIL3q0",
};

// Nur Opportunities aus der Setting-Phase werden verschoben
const SETTING_STATUSES = new Set([
  STATUS.settingTerminiert,
  STATUS.settingNoShow,
  STATUS.settingFollowUp,
]);

interface CloseWebhookEvent {
  event?: {
    object_type?: string;
    action?: string;
    lead_id?: string;
    data?: Record<string, unknown>;
  };
}

/** Close signiert mit HMAC-SHA256(hex-Key, timestamp + body). */
function verifySignature(body: string, timestamp: string | null, hash: string | null) {
  const key = process.env.CLOSE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !timestamp || !hash) return false;
  const expected = createHmac("sha256", Buffer.from(key, "hex"))
    .update(timestamp + body)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const body = await request.text();
  const supabase = createAdminClient();

  if (
    !verifySignature(
      body,
      request.headers.get("close-sig-timestamp"),
      request.headers.get("close-sig-hash"),
    )
  ) {
    await supabase.from("webhook_errors").insert({
      endpoint: "close",
      payload: { body: body.slice(0, 2000) },
      error: "Ungültige Signatur",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { event } = JSON.parse(body) as CloseWebhookEvent;
  const data = event?.data ?? {};

  if (
    event?.object_type !== "activity.custom_activity" ||
    data.custom_activity_type_id !== SETTING_PROTOKOLL_TYPE ||
    data.status !== "published" ||
    data[SETTING_NAECHSTER_SCHRITT] !== CLOSING_GELEGT
  ) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const leadId = (data.lead_id as string | undefined) ?? event.lead_id;
  if (!leadId) return NextResponse.json({ ok: true, skipped: true });

  try {
    const { data: opportunities } = await closeApi<{
      data: Array<{ id: string; status_id: string }>;
    }>("/opportunity/", { params: { lead_id: leadId } });

    const toMove = opportunities.filter((o) => SETTING_STATUSES.has(o.status_id));

    for (const opp of toMove) {
      await closeApi(`/opportunity/${opp.id}/`, {
        method: "PUT",
        body: { status_id: STATUS.closingTerminiert },
      });
    }

    if (toMove.length === 0) {
      await supabase.from("webhook_errors").insert({
        endpoint: "close",
        payload: { lead_id: leadId, activity_id: data.id },
        error: "Closing gelegt, aber keine Opportunity in Setting-Phase gefunden",
      });
    }

    return NextResponse.json({ ok: true, moved: toMove.map((o) => o.id) });
  } catch (err) {
    await supabase.from("webhook_errors").insert({
      endpoint: "close",
      payload: { lead_id: leadId, activity_id: data.id },
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Update fehlgeschlagen" }, { status: 500 });
  }
}
