import type { SupabaseClient } from "@supabase/supabase-js";
import { verarbeiteEingang } from "./antworten";
import { MIN_REST_MS } from "./logik";

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
  claimed_at: string;
}


/** Ergebnis nur für den eigenen Claim schreiben (status 'in_arbeit' + claimed_at). */
async function schreibe(svc: SupabaseClient, z: EingangZeile, update: Record<string, unknown>) {
  const { error } = await svc
    .from("wa_eingang")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", z.id)
    .eq("status", "in_arbeit")
    .eq("claimed_at", z.claimed_at);
  if (error) throw new Error(`Eingang ${z.wa_message_id} nicht aktualisiert: ${error.message}`);
}

async function verarbeiteZeile(svc: SupabaseClient, z: EingangZeile): Promise<boolean> {
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
    await schreibe(svc, z, { status: "verarbeitet", fehler: null });
    return true;
  } catch (err) {
    const fehler = err instanceof Error ? err.message : String(err);
    await schreibe(svc, z, { status: "fehler", fehler: fehler.slice(0, 1000) });
    await svc.from("webhook_errors").insert({ endpoint: "whatsapp", payload: { wa_message_id: z.wa_message_id }, error: fehler });
    return false;
  }
}

/**
 * Offene Eingänge atomar übernehmen (wa_eingang_claim, SKIP LOCKED) und verarbeiten.
 * Mit waMessageIds: genau diese (direkt nach dem Webhook). Ohne (Cron): 'neu' älter als
 * 2 Min. und 'fehler' mit < 5 Versuchen. Vor jedem Eintrag müssen ≥ 15 s bis zur Deadline
 * bleiben; übernommene, nicht bearbeitete Einträge gehen zurück.
 */
export async function verarbeiteOffeneEingaenge(
  svc: SupabaseClient,
  opts: { waMessageIds?: string[]; deadline: number },
): Promise<{ verarbeitet: number; fehler: number; zurueckgelegt: number }> {
  const ergebnis = { verarbeitet: 0, fehler: 0, zurueckgelegt: 0 };
  if (opts.waMessageIds && opts.waMessageIds.length === 0) return ergebnis;

  while (opts.deadline - Date.now() >= MIN_REST_MS) {
    const { data, error } = await svc.rpc("wa_eingang_claim", { p_ids: opts.waMessageIds ?? null, p_limit: 5 });
    if (error) throw new Error(`Eingang nicht abrufbar: ${error.message}`);
    const zeilen = (data ?? []) as EingangZeile[];
    if (zeilen.length === 0) break;

    for (const z of zeilen) {
      if (opts.deadline - Date.now() < MIN_REST_MS) {
        // Zeit reicht nicht → unbearbeitet zurückgeben (Versuch nicht zählen)
        await schreibe(svc, z, {
          status: z.versuche > 1 ? "fehler" : "neu",
          versuche: Math.max(0, z.versuche - 1),
          claimed_at: null,
        });
        ergebnis.zurueckgelegt++;
        continue;
      }
      if (await verarbeiteZeile(svc, z)) ergebnis.verarbeitet++;
      else ergebnis.fehler++;
    }
    // Mit festen IDs gibt es nach einem Durchlauf nichts mehr zu holen
    if (opts.waMessageIds) break;
  }
  return ergebnis;
}
