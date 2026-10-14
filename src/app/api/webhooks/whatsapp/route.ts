import { createHmac, timingSafeEqual } from "crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { meldeNichtZugestellt } from "@/lib/whatsapp/close-log";
import { speichereEingang, verarbeiteOffeneEingaenge, type WaNachricht } from "@/lib/whatsapp/eingang";
import { darfStatusSetzen } from "@/lib/whatsapp/logik";

// WhatsApp-Webhook (Meta Cloud API): eingehende Nachrichten, Zustellstatus,
// Freigabe-Status/Kategorie der Vorlagen. Eingehende Nachrichten werden VOR der 200-Antwort
// dauerhaft gespeichert (wa_eingang), die Verarbeitung läuft danach; der Cron arbeitet nach.

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
        messages?: unknown[];
        statuses?: WaStatus[];
        event?: string;
        message_template_name?: string;
        message_template_language?: string;
        message_template_id?: number | string;
        reason?: string | null;
        new_category?: string;
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

/** Meta-Ereignis → Status in wa_vorlagen (REINSTATED = wieder freigegeben). */
function vorlagenStatus(event: string): string {
  const e = event.toUpperCase();
  return e === "REINSTATED" ? "APPROVED" : e;
}

async function verarbeite(body: WaWebhook) {
  const svc = createAdminClient();
  const logFehler = (payload: Record<string, unknown>, error: string) =>
    svc.from("webhook_errors").insert({ endpoint: "whatsapp", payload, error });

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      if (change.field === "messages") {
        for (const s of value.statuses ?? []) {
          const neu = STATUS[s.status];
          if (!neu) continue;
          try {
            const { data } = await svc
              .from("wa_nachrichten")
              .select("id, status, typ, vorlage, termin_id, close_lead_id")
              .eq("wa_message_id", s.id)
              .maybeSingle();
            const alt = data as {
              id: string;
              status: string;
              typ: string | null;
              vorlage: string | null;
              termin_id: string | null;
              close_lead_id: string | null;
            } | null;
            if (!alt || !darfStatusSetzen(alt.status, neu)) continue; // nie zurückstufen
            const fehler = s.errors?.[0];
            const fehlerText = fehler
              ? [fehler.code, fehler.title, fehler.error_data?.details].filter(Boolean).join(" · ").slice(0, 500)
              : null;
            const { error: uFehler } = await svc
              .from("wa_nachrichten")
              .update({ status: neu, ...(fehlerText ? { fehler: fehlerText } : {}) })
              .eq("id", alt.id);
            if (uFehler) throw new Error(`Status nicht gespeichert: ${uFehler.message}`);
            // Fehlversuch im CRM sichtbar machen (Notiz + Statusfeld)
            if (neu === "fehlgeschlagen") {
              await meldeNichtZugestellt(svc, {
                closeLeadId: alt.close_lead_id,
                terminId: alt.termin_id,
                typ: alt.typ,
                vorlage: alt.vorlage,
                fehler: fehlerText ?? "ohne Fehlerangabe",
              });
            }
          } catch (err) {
            await logFehler({ status: s.id }, err instanceof Error ? err.message : String(err));
          }
        }
      }

    }
  }
}

/**
 * Vorlagen-Kategorie und -Status synchron speichern (vor der Antwort):
 * Supabase-Fehler → throw → 500, damit Meta erneut zustellt.
 */
async function speichereVorlagenEreignisse(body: WaWebhook) {
  const svc = createAdminClient();
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      if ((change.field === "template_category_update" || change.field === "message_template_category_update") && value.message_template_name && value.new_category) {
        const { error } = await svc
          .from("wa_vorlagen")
          .update({ kategorie: value.new_category.toUpperCase(), geprueft_am: new Date().toISOString() })
          .eq("name", value.message_template_name);
        if (error) throw new Error(`Vorlagen-Kategorie nicht gespeichert: ${error.message}`);
      }

      if (change.field === "message_template_status_update" && value.message_template_name) {
        const status = vorlagenStatus(value.event ?? "");
        const { error } = await svc.from("wa_vorlagen").upsert(
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
        if (error) throw new Error(`Vorlagen-Status nicht gespeichert: ${error.message}`);
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

  // Eingehende Nachrichten dauerhaft speichern, bevor wir quittieren (sonst 500 → Meta wiederholt)
  const nachrichten: WaNachricht[] = (daten.entry ?? []).flatMap((e) =>
    (e.changes ?? []).filter((c) => c.field === "messages").flatMap((c) => (c.value?.messages ?? []) as WaNachricht[]),
  );
  try {
    const svc = createAdminClient();
    for (const m of nachrichten) await speichereEingang(svc, m);
    await speichereVorlagenEreignisse(daten);
  } catch (err) {
    console.error("[whatsapp] Webhook nicht gespeichert:", err);
    return NextResponse.json({ error: "Speichern fehlgeschlagen" }, { status: 500 });
  }

  // Sofort quittieren; Verarbeitung läuft nach der Antwort weiter (Cron arbeitet Reste nach)
  after(async () => {
    try {
      const svc = createAdminClient();
      await verarbeite(daten);
      await verarbeiteOffeneEingaenge(svc, {
        waMessageIds: nachrichten.map((m) => m.id),
        deadline: Date.now() + 45_000,
      });
    } catch (err) {
      await createAdminClient()
        .from("webhook_errors")
        .insert({ endpoint: "whatsapp", payload: {}, error: err instanceof Error ? err.message : String(err) });
    }
  });
  return NextResponse.json({ ok: true });
}
