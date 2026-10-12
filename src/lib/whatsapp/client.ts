/**
 * WhatsApp Cloud API (Meta Graph) — ein Konto per Umgebungsvariablen.
 *
 * Die send*-Funktionen hier senden OHNE Prüfung. Sie dürfen ausschließlich
 * aus gate.ts aufgerufen werden (zentrale Sendeprüfung).
 */

/** Pflicht-Variablen — fehlt eine, gilt der Bot als „nicht verbunden“ und sendet nichts. */
export const WA_ENV_PFLICHT = [
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_WABA_ID",
  "META_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
] as const;

/** Weitere Variablen, die für einzelne Funktionen nötig sind (Anzeige im Dashboard). */
export const WA_ENV_WEITERE = [
  "CALENDLY_WEBHOOK_SIGNING_KEY",
  "WHATSAPP_ADMIN_PIN",
  "CRON_SECRET",
  "CLOSE_API_KEY",
  "TERMIN_BASE_URL",
  "WHATSAPP_GRAPH_VERSION",
] as const;

export const STANDARD_BASIS_URL = "https://cloud.hoffmannsolutions.de";

export function waVerbindung(): { verbunden: boolean; fehlend: string[] } {
  const fehlend = WA_ENV_PFLICHT.filter((k) => !process.env[k]);
  return { verbunden: fehlend.length === 0, fehlend };
}

/** Basis-URL für Knopf-Links (/t, /j, /n). */
export function terminBasisUrl(): string {
  return (process.env.TERMIN_BASE_URL || STANDARD_BASIS_URL).replace(/\/+$/, "");
}

function graphBasis(): string {
  return `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v23.0"}`;
}

async function graph<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("WHATSAPP_TOKEN fehlt");
  const res = await fetch(`${graphBasis()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = (data as { error?: { message?: string; error_user_msg?: string; code?: number } } | null)?.error;
    throw new Error(
      `WhatsApp API Fehler ${res.status}${e?.code ? ` (${e.code})` : ""}: ${e?.error_user_msg || e?.message || text.slice(0, 300)}`,
    );
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Senden (nur über gate.ts!)
// ---------------------------------------------------------------------------

async function sende(payload: Record<string, unknown>): Promise<string> {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new Error("WHATSAPP_PHONE_NUMBER_ID fehlt");
  const data = await graph<{ messages?: Array<{ id: string }> }>(`/${id}/messages`, {
    method: "POST",
    body: { messaging_product: "whatsapp", recipient_type: "individual", ...payload },
  });
  const messageId = data?.messages?.[0]?.id;
  if (!messageId) throw new Error("WhatsApp API: Antwort ohne Message-ID");
  return messageId;
}

export function sendeVorlageRoh(
  an: string,
  name: string,
  sprache: string,
  components: Array<Record<string, unknown>>,
): Promise<string> {
  return sende({ to: an, type: "template", template: { name, language: { code: sprache }, components } });
}

export function sendeTextRoh(an: string, text: string): Promise<string> {
  return sende({ to: an, type: "text", text: { body: text, preview_url: true } });
}

export function sendeVideoRoh(an: string, link: string, caption?: string): Promise<string> {
  return sende({ to: an, type: "video", video: { link, ...(caption ? { caption } : {}) } });
}

// ---------------------------------------------------------------------------
// Vorlagen-Verwaltung
// ---------------------------------------------------------------------------

export interface MetaVorlage {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  rejected_reason?: string | null;
}

/** Vorlage einreichen (echte Aktion — nur per Knopf im Dashboard). */
export async function reicheVorlageEinMeta(definition: Record<string, unknown>): Promise<{ id: string; status: string }> {
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!waba) throw new Error("WHATSAPP_WABA_ID fehlt");
  const data = await graph<{ id?: string; status?: string }>(`/${waba}/message_templates`, {
    method: "POST",
    body: definition,
  });
  if (!data?.id) throw new Error("Meta hat keine Vorlagen-ID geliefert");
  return { id: data.id, status: data.status ?? "PENDING" };
}

/** Alle Vorlagen des Kontos (nur lesen). */
export async function listeVorlagenMeta(): Promise<MetaVorlage[]> {
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!waba) throw new Error("WHATSAPP_WABA_ID fehlt");
  const alle: MetaVorlage[] = [];
  let pfad: string | null =
    `/${waba}/message_templates?limit=100&fields=id,name,status,category,language,rejected_reason`;
  for (let seite = 0; pfad && seite < 10; seite++) {
    const data: { data?: MetaVorlage[]; paging?: { cursors?: { after?: string }; next?: string } } = await graph(pfad);
    alle.push(...(data.data ?? []));
    const after = data.paging?.next ? data.paging.cursors?.after : undefined;
    pfad = after
      ? `/${waba}/message_templates?limit=100&fields=id,name,status,category,language,rejected_reason&after=${encodeURIComponent(after)}`
      : null;
  }
  return alle;
}
