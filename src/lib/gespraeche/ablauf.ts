import type { SupabaseClient } from "@supabase/supabase-js";
import { terminBasisUrl } from "@/lib/whatsapp/client";
import { berlinTag, freieUploads, uploadPrioritaet, UPLOAD_MAX_TAGE, zuAltFuerUpload, type Phase } from "./logik";
import { aufnahmeLink } from "./close-anrufe";
import { BudgetErschoepft, budgetHeute, ladeAudioHoch, ladeTranskript, listeTranskripte } from "./fireflies";

/**
 * Warteschlange Close-Aufnahme → Fireflies → Transkript (Status neu → hochgeladen → transkribiert).
 * Reihenfolge innerhalb des Tagesbudgets: erst offene Transkripte abholen, dann neue Uploads
 * (Closing > Setting > Opening, Opening die längsten zuerst). Rückstand läuft an Folgetagen weiter.
 */

const MIN = 60_000;
const SUCHE_ALLE_MS = 30 * MIN;
const NICHT_GEFUNDEN_NACH_MS = 24 * 60 * MIN;
const MAX_UPLOADS = 2;

const jetztIso = () => new Date().toISOString();

const webhookUrl = () => `${terminBasisUrl()}/api/webhooks/fireflies`;

/** Titel enthält die call_id → Transkript lässt sich ohne Webhook wiederfinden und prüfen */
export const firefliesTitel = (g: { call_id: string; user_name: string | null; lead_name: string | null }) =>
  `${g.user_name ?? "Call"} · ${g.lead_name ?? "Lead"} · ${g.call_id}`;

/** Transkript abholen und speichern. Prüft, dass es wirklich zu diesem Call gehört. */
export async function holeTranskript(svc: SupabaseClient, callId: string, firefliesId: string): Promise<"transkribiert" | "uebersprungen"> {
  const t = await ladeTranskript(svc, firefliesId);
  if (!t) throw new Error("Transkript nicht gefunden");
  if (!t.title?.includes(callId)) throw new Error("Transkript gehört nicht zu diesem Call");
  const saetze = (t.sentences ?? []).map((s) => ({ speaker_name: s.speaker_name, text: s.text, start_time: s.start_time }));
  const status = saetze.length ? "transkribiert" : "uebersprungen";
  await svc
    .from("gespraeche")
    .update({
      status,
      fireflies_id: firefliesId,
      transkript: saetze.length ? saetze : null,
      fehler: saetze.length ? null : "kein Gesprächsinhalt im Transkript",
      versuche: 0,
      updated_at: jetztIso(),
    })
    .eq("call_id", callId);
  return status;
}

/** Webhook „Transkript fertig“: Fireflies-ID merken (falls das Budget heute leer ist, holt der Cron später ab) und Transkript laden */
export async function verarbeiteFertigMeldung(svc: SupabaseClient, callId: string, firefliesId: string): Promise<string> {
  const { data } = await svc.from("gespraeche").select("status").eq("call_id", callId).maybeSingle();
  if ((data as { status: string } | null)?.status !== "hochgeladen") return "ignoriert";
  await svc.from("gespraeche").update({ fireflies_id: firefliesId, updated_at: jetztIso() }).eq("call_id", callId).eq("status", "hochgeladen");
  try {
    return await holeTranskript(svc, callId, firefliesId);
  } catch (err) {
    if (err instanceof BudgetErschoepft) return "wartet auf Budget";
    // Falsche ID (z. B. gefälschte Meldung) wieder vergessen, die Suche findet die richtige
    await svc.from("gespraeche").update({ fireflies_id: null, updated_at: jetztIso() }).eq("call_id", callId).eq("status", "hochgeladen");
    throw err;
  }
}

interface Hochgeladen {
  call_id: string;
  fireflies_id: string | null;
  hochgeladen_am: string | null;
  versuche: number;
}

/**
 * Hochgeladene Calls nachhalten: bekannte Fireflies-ID → Transkript holen; ohne ID nach 30 Min.
 * höchstens alle 30 Min. einmal per Liste suchen; nach 24 Std. ohne Transkript erneut hochladen bzw. Fehler.
 */
export async function pruefeHochgeladene(svc: SupabaseClient, deadline: number): Promise<string> {
  const { data, error } = await svc.from("gespraeche").select("call_id, fireflies_id, hochgeladen_am, versuche").eq("status", "hochgeladen").order("datum");
  if (error) throw new Error(`Gespräche nicht lesbar: ${error.message}`);
  const alle = (data ?? []) as Hochgeladen[];
  if (!alle.length) return "nichts offen";
  const jetzt = Date.now();
  let geholt = 0;

  // 1) Ohne Fireflies-ID und lange überfällig → neu hochladen (einmal) oder Fehler
  const ueberfaellig = alle.filter((x) => !x.fireflies_id && x.hochgeladen_am && jetzt - new Date(x.hochgeladen_am).getTime() > NICHT_GEFUNDEN_NACH_MS);
  const offen = alle.filter((x) => !ueberfaellig.includes(x));
  for (const g of ueberfaellig) {
    const versuche = g.versuche + 1;
    await svc
      .from("gespraeche")
      .update({ status: versuche >= 2 ? "fehler" : "neu", fehler: "Fireflies-Transkript nach 24 Std. nicht gefunden", versuche, updated_at: jetztIso() })
      .eq("call_id", g.call_id);
  }

  try {
    // 2) Suche nach Transkripten, deren Webhook ausblieb (ein Aufruf für alle)
    const suchen = offen.filter((x) => !x.fireflies_id && x.hochgeladen_am && jetzt - new Date(x.hochgeladen_am).getTime() > SUCHE_ALLE_MS);
    if (suchen.length) {
      const b = await budgetHeute(svc);
      if (!b.sucheAm || jetzt - new Date(b.sucheAm).getTime() > SUCHE_ALLE_MS) {
        await svc.from("gespraeche_budget").upsert({ tag: berlinTag(new Date()), suche_am: jetztIso() }, { onConflict: "tag" });
        const aeltester = Math.min(...suchen.map((x) => new Date(x.hochgeladen_am!).getTime()));
        const liste = await listeTranskripte(svc, new Date(aeltester - 60 * MIN));
        for (const g of suchen) {
          const t = liste.find((x) => x.title?.includes(g.call_id));
          if (t) g.fireflies_id = t.id;
        }
      }
    }
    // 3) Transkripte mit bekannter ID abholen
    for (const g of offen.filter((x) => x.fireflies_id)) {
      if (deadline - Date.now() < 20_000) break;
      try {
        await holeTranskript(svc, g.call_id, g.fireflies_id!);
        geholt++;
      } catch (err) {
        if (err instanceof BudgetErschoepft) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        const versuche = g.versuche + 1;
        await svc
          .from("gespraeche")
          .update({ status: versuche >= 3 ? "fehler" : "hochgeladen", fehler: msg.slice(0, 500), versuche, updated_at: jetztIso() })
          .eq("call_id", g.call_id);
      }
    }
  } catch (err) {
    if (err instanceof BudgetErschoepft) return `${geholt} Transkript(e) geholt – ${err.message}`;
    throw err;
  }
  return `${geholt} Transkript(e) geholt`;
}

interface NeuerCall {
  call_id: string;
  user_name: string | null;
  lead_name: string | null;
  phase: Phase;
  dauer_sek: number | null;
  datum: string;
  aufnahme_url: string | null;
  versuche: number;
}

/** Wichtige neue Calls hochladen, soweit das Budget (inkl. Reserve für die Transkript-Abrufe) reicht */
export async function ladeNeueHoch(svc: SupabaseClient, deadline: number): Promise<string> {
  const jetzt = new Date();
  const { data, error } = await svc
    .from("gespraeche")
    .select("call_id, user_name, lead_name, phase, dauer_sek, datum, aufnahme_url, versuche")
    .eq("status", "neu")
    .order("datum")
    .limit(500);
  if (error) throw new Error(`Gespräche nicht lesbar: ${error.message}`);
  const alle = (data ?? []) as NeuerCall[];

  // Zu alt → nicht mehr hochladen
  const alt = alle.filter((g) => zuAltFuerUpload(g.datum, jetzt));
  if (alt.length) {
    await svc
      .from("gespraeche")
      .update({ status: "uebersprungen", fehler: `Budget: älter als ${UPLOAD_MAX_TAGE} Tage`, updated_at: jetztIso() })
      .in("call_id", alt.map((g) => g.call_id));
  }
  const warteschlange = alle.filter((g) => !zuAltFuerUpload(g.datum, jetzt)).sort(uploadPrioritaet);
  if (!warteschlange.length) return "keine neuen";

  const b = await budgetHeute(svc);
  const { count } = await svc.from("gespraeche").select("call_id", { count: "exact", head: true }).eq("status", "hochgeladen");
  const frei = Math.min(freieUploads(b.rest, count ?? 0), MAX_UPLOADS);
  if (!frei) return `${warteschlange.length} warten (Budget ${b.aufrufe}/${b.limit}${b.gesperrt ? ", gesperrt" : ""})`;

  let hoch = 0;
  for (const g of warteschlange.slice(0, frei)) {
    if (deadline - Date.now() < 30_000) break;
    const titel = firefliesTitel(g);
    try {
      if (!g.aufnahme_url) throw new Error("keine Aufnahme");
      const url = await aufnahmeLink(g.aufnahme_url);
      await ladeAudioHoch(svc, { url, titel, callId: g.call_id, webhook: webhookUrl() });
      await svc
        .from("gespraeche")
        .update({ status: "hochgeladen", fireflies_titel: titel, hochgeladen_am: jetztIso(), fehler: null, updated_at: jetztIso() })
        .eq("call_id", g.call_id);
      hoch++;
    } catch (err) {
      if (err instanceof BudgetErschoepft) break;
      const msg = err instanceof Error ? err.message : String(err);
      const versuche = g.versuche + 1;
      await svc
        .from("gespraeche")
        .update({ status: versuche >= 3 ? "fehler" : "neu", fehler: msg.slice(0, 500), versuche, updated_at: jetztIso() })
        .eq("call_id", g.call_id);
    }
  }
  return `${hoch} hochgeladen, ${warteschlange.length - hoch} warten`;
}
