import type { SupabaseClient } from "@supabase/supabase-js";
import { berlinTag, istRateLimit, TAGESLIMIT, zahlAusEnv, type Satz } from "./logik";

/**
 * Fireflies-GraphQL-API (FIREFLIES_API_KEY). Jeder Aufruf geht durchs Tagesbudget
 * (FIREFLIES_TAGESLIMIT, Standard 50, in gespraeche_budget gezählt). Bei Rate-Limit wird der Tag gesperrt.
 */

const API = "https://api.fireflies.ai/graphql";
const TIMEOUT_MS = 20_000;

/** Budget für heute aufgebraucht oder gesperrt → für diesen Lauf aufhören */
export class BudgetErschoepft extends Error {
  constructor(meldung = "Fireflies-Tagesbudget aufgebraucht") {
    super(meldung);
    this.name = "BudgetErschoepft";
  }
}

export const tagesLimit = () => zahlAusEnv(process.env.FIREFLIES_TAGESLIMIT, TAGESLIMIT);
export const firefliesAktiv = () => !!process.env.FIREFLIES_API_KEY;

/** Stand von heute: verbrauchte Aufrufe, gesperrt, letzte Suche */
export async function budgetHeute(svc: SupabaseClient, jetzt = new Date()) {
  const { data } = await svc
    .from("gespraeche_budget")
    .select("aufrufe, gesperrt, suche_am")
    .eq("tag", berlinTag(jetzt))
    .maybeSingle();
  const b = data as { aufrufe: number; gesperrt: boolean; suche_am: string | null } | null;
  const limit = tagesLimit();
  const aufrufe = b?.aufrufe ?? 0;
  return { aufrufe, limit, gesperrt: !!b?.gesperrt, rest: b?.gesperrt ? 0 : Math.max(0, limit - aufrufe), sucheAm: b?.suche_am ?? null };
}

async function gql<T>(svc: SupabaseClient, query: string, variables: Record<string, unknown>): Promise<T> {
  const key = process.env.FIREFLIES_API_KEY;
  if (!key) throw new Error("FIREFLIES_API_KEY ist nicht hinterlegt");
  const tag = berlinTag(new Date());
  const { data: ok, error } = await svc.rpc("gespraeche_budget_nehmen", { p_tag: tag, p_limit: tagesLimit() });
  if (error) throw new Error(`Fireflies-Budget nicht lesbar: ${error.message}`);
  if (!ok) throw new BudgetErschoepft();

  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: T;
    errors?: Array<{ message: string; code?: string; extensions?: { code?: string } }>;
  };
  const fehler = body.errors?.[0];
  const meldung = fehler ? `${fehler.message} ${fehler.code ?? fehler.extensions?.code ?? ""}`.trim() : null;
  if (istRateLimit(res.status, meldung)) {
    await svc.rpc("gespraeche_budget_sperren", { p_tag: tag });
    throw new BudgetErschoepft(`Fireflies-Rate-Limit: ${meldung ?? res.status}`);
  }
  if (!res.ok || fehler) throw new Error(`Fireflies: ${meldung ?? res.status}`);
  return body.data as T;
}

export interface FfTranskript {
  id: string;
  title: string | null;
  duration: number | null;
  sentences: Satz[] | null;
}

export async function ladeTranskript(svc: SupabaseClient, id: string): Promise<FfTranskript | null> {
  const d = await gql<{ transcript: FfTranskript | null }>(
    svc,
    `query Transcript($id: String!) {
      transcript(id: $id) { id title duration sentences { speaker_name text start_time } }
    }`,
    { id },
  );
  return d.transcript;
}

/** Transkripte ab einem Datum (Suche nach Uploads, deren Webhook ausgeblieben ist) — ein Aufruf */
export async function listeTranskripte(svc: SupabaseClient, ab: Date): Promise<Array<{ id: string; title: string | null }>> {
  const d = await gql<{ transcripts: Array<{ id: string; title: string | null }> | null }>(
    svc,
    `query Recent($from: DateTime, $limit: Int) { transcripts(fromDate: $from, limit: $limit) { id title } }`,
    { from: ab.toISOString(), limit: 50 },
  );
  return d.transcripts ?? [];
}

/** Aufnahme (signierter Link) an Fireflies zur Transkription geben; Webhook meldet „fertig“ */
export async function ladeAudioHoch(
  svc: SupabaseClient,
  input: { url: string; titel: string; callId: string; webhook: string | null },
): Promise<void> {
  const d = await gql<{ uploadAudio: { success: boolean; message: string | null } | null }>(
    svc,
    `mutation Upload($input: AudioUploadInput) { uploadAudio(input: $input) { success title message } }`,
    {
      input: {
        url: input.url,
        title: input.titel,
        client_reference_id: input.callId,
        custom_language: "de",
        ...(input.webhook ? { webhook: input.webhook } : {}),
      },
    },
  );
  if (!d.uploadAudio?.success) throw new Error(`Fireflies-Upload abgelehnt: ${d.uploadAudio?.message ?? "unbekannt"}`);
}
