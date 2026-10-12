import type { SupabaseClient } from "@supabase/supabase-js";
import { verarbeiteEingang } from "./antworten";

/**
 * Eingang von Meta: Rohereignisse werden VOR der 200-Antwort in wa_eingang gespeichert,
 * danach (after()) verarbeitet. Der Cron arbeitet liegengebliebene bzw. fehlgeschlagene
 * Einträge nach (max. 5 Versuche). Dedupe über status 'verarbeitet'.
 */

export interface WaNachricht {
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
  reaction?: { message_id?: string; emoji?: string };
}

const MAX_VERSUCHE = 5;

export function nachrichtText(m: WaNachricht): string {
  if (m.type === "reaction") return `Reaktion ${m.reaction?.emoji ?? ""}`.trim();
  return (
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    m.text?.body ??
    `[${m.type}]`
  );
}

/** Rohereignis dauerhaft speichern (doppelte Zustellung → ignoriert). Fehler werden geworfen → 500 an Meta. */
export async function speichereEingang(svc: SupabaseClient, m: WaNachricht): Promise<void> {
  const { error } = await svc.from("wa_eingang").insert({ wa_message_id: m.id, payload: m, status: "neu" });
  if (error && error.code !== "23505") throw new Error(`Eingang nicht gespeichert: ${error.message}`);
}

interface EingangZeile {
  id: string;
  wa_message_id: string;
  payload: WaNachricht;
  status: string;
  versuche: number;
}

async function verarbeiteZeile(svc: SupabaseClient, z: EingangZeile): Promise<boolean> {
  if (z.status === "verarbeitet") return true;
  const m = z.payload;
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
    await svc
      .from("wa_eingang")
      .update({ status: "verarbeitet", versuche: z.versuche + 1, fehler: null, updated_at: new Date().toISOString() })
      .eq("id", z.id);
    return true;
  } catch (err) {
    const fehler = err instanceof Error ? err.message : String(err);
    await svc
      .from("wa_eingang")
      .update({ status: "fehler", versuche: z.versuche + 1, fehler: fehler.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", z.id);
    await svc.from("webhook_errors").insert({ endpoint: "whatsapp", payload: { wa_message_id: z.wa_message_id }, error: fehler });
    return false;
  }
}

/**
 * Offene Eingänge verarbeiten. Mit ids: genau diese (direkt nach dem Webhook).
 * Ohne ids (Cron): 'neu' älter als 2 Min. (der Webhook ist dann sicher fertig) und 'fehler' < 5 Versuche.
 */
export async function verarbeiteOffeneEingaenge(
  svc: SupabaseClient,
  opts: { waMessageIds?: string[]; budgetMs?: number } = {},
): Promise<{ verarbeitet: number; fehler: number }> {
  const ende = Date.now() + (opts.budgetMs ?? 20_000);
  let q = svc.from("wa_eingang").select("id, wa_message_id, payload, status, versuche").order("created_at").limit(50);
  if (opts.waMessageIds) {
    if (opts.waMessageIds.length === 0) return { verarbeitet: 0, fehler: 0 };
    q = q.in("wa_message_id", opts.waMessageIds).neq("status", "verarbeitet");
  } else {
    const grenze = new Date(Date.now() - 2 * 60_000).toISOString();
    q = q
      .lt("versuche", MAX_VERSUCHE)
      .or(`and(status.eq.neu,created_at.lt.${grenze}),and(status.eq.fehler,updated_at.lt.${grenze})`);
  }
  const { data, error } = await q;
  if (error) throw new Error(`Eingang nicht lesbar: ${error.message}`);
  let verarbeitet = 0;
  let fehler = 0;
  for (const z of (data ?? []) as EingangZeile[]) {
    if (Date.now() > ende) break;
    if (await verarbeiteZeile(svc, z)) verarbeitet++;
    else fehler++;
  }
  return { verarbeitet, fehler };
}
