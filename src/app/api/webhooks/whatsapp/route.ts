import { createHmac, timingSafeEqual } from "crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verarbeiteEingang } from "@/lib/whatsapp/antworten";
import { darfStatusSetzen, normalisiereTelefon } from "@/lib/whatsapp/logik";

// WhatsApp-Webhook (Meta Cloud API): eingehende Nachrichten, Zustellstatus,
// Freigabe-Status der Vorlagen. Antwortet sofort mit 200, verarbeitet danach.

export const maxDuration = 60;

/** Meta-Verifizierung beim Einrichten des Webhooks (hub.challenge). */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (p.get("hub.mode") === "subscribe" && token && p.get("hub.verify_token") === token && p.get("hub.challenge")) {
    return new NextResponse(p.get("hub.challenge"), { status: 200 });
  }
  return NextResponse.json({ error: "Verifizierung fehlgeschlagen" }, { status: 403 });
}

function pruefeSignatur(body: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const erwartet = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"));
  const erhalten = Buffer.from(header.slice("sha256=".length));
  return erwartet.length === erhalten.length && timingSafeEqual(erwartet, erhalten);
}

interface WaNachricht {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}

interface WaStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed" | string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
}

interface WaWebhook {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        messages?: WaNachricht[];
        statuses?: WaStatus[];
        event?: string;
        message_template_name?: string;
        message_template_language?: string;
        message_template_id?: number | string;
        reason?: string | null;
      };
    }>;
  }>;
}

const STATUS: Record<string, string> = {
  sent: "gesendet",
  delivered: "zugestellt",
  read: "gelesen",
  failed: "fehlgeschlagen",
};

function nachrichtText(m: WaNachricht): string {
  return (
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    m.text?.body ??
    `[${m.type}]`
  );
}

async function verarbeite(body: WaWebhook) {
  const svc = createAdminClient();
  const logFehler = (payload: Record<string, unknown>, error: string) =>
    svc.from("webhook_errors").insert({ endpoint: "whatsapp", payload, error });

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      if (change.field === "messages") {
        for (const m of value.messages ?? []) {
          try {
            await verarbeiteEingang(svc, {
              telefonRoh: m.from,
              waMessageId: m.id,
              typ: m.type,
              text: nachrichtText(m),
              buttonPayload: m.button?.payload ?? m.interactive?.button_reply?.id ?? null,
              zeit: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
              payload: m,
            });
          } catch (err) {
            await logFehler(
              { wa_message_id: m.id, von: normalisiereTelefon(m.from) },
              err instanceof Error ? err.message : String(err),
            );
          }
        }

        for (const s of value.statuses ?? []) {
          const neu = STATUS[s.status];
          if (!neu) continue;
          try {
            const { data } = await svc.from("wa_nachrichten").select("id, status").eq("wa_message_id", s.id).maybeSingle();
            const alt = data as { id: string; status: string } | null;
            if (!alt || !darfStatusSetzen(alt.status, neu)) continue; // nie zurückstufen
            const fehler = s.errors?.[0];
            await svc
              .from("wa_nachrichten")
              .update({
                status: neu,
                ...(fehler
                  ? { fehler: [fehler.code, fehler.title, fehler.error_data?.details].filter(Boolean).join(" · ").slice(0, 500) }
                  : {}),
              })
              .eq("id", alt.id);
          } catch (err) {
            await logFehler({ status: s.id }, err instanceof Error ? err.message : String(err));
          }
        }
      }

      if (change.field === "message_template_status_update" && value.message_template_name) {
        try {
          const status = (value.event ?? "").toUpperCase();
          await svc.from("wa_vorlagen").upsert(
            {
              name: value.message_template_name,
              sprache: value.message_template_language ?? "de",
              status,
              meta_id: value.message_template_id != null ? String(value.message_template_id) : null,
              ablehnungsgrund: status === "REJECTED" && value.reason && value.reason !== "NONE" ? value.reason : null,
              geprueft_am: new Date().toISOString(),
            },
            { onConflict: "name" },
          );
        } catch (err) {
          await logFehler({ vorlage: value.message_template_name }, err instanceof Error ? err.message : String(err));
        }
      }
    }
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (!pruefeSignatur(body, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Ungültige Signatur" }, { status: 401 });
  }

  let daten: WaWebhook;
  try {
    daten = JSON.parse(body) as WaWebhook;
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON" }, { status: 400 });
  }

  // Sofort quittieren — Meta wiederholt sonst; Verarbeitung läuft nach der Antwort weiter
  after(async () => {
    try {
      await verarbeite(daten);
    } catch (err) {
      await createAdminClient()
        .from("webhook_errors")
        .insert({ endpoint: "whatsapp", payload: {}, error: err instanceof Error ? err.message : String(err) });
    }
  });
  return NextResponse.json({ ok: true });
}
