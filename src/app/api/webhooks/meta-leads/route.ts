import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gleichSicher, leseMetaAenderungen, leseMetaLead, metaSignaturGueltig, metaTreffer, metaZuordnung, type MetaAenderung } from "@/lib/eingang/logik";
import {
  emailAnBetrieb,
  holeMetaLead,
  metaTokenEnvName,
  protokolliere,
  speichereLead,
  type LeadQuelleZeile,
} from "@/lib/eingang/verarbeitung";

/**
 * Meta-Leadformulare (zentral für alle Betriebe): Meta-App → Webhooks → Objekt „Page“, Feld „leadgen“.
 * GET  = Verifizierung (hub.mode=subscribe, hub.verify_token = META_LEADS_VERIFY_TOKEN → hub.challenge)
 * POST = X-Hub-Signature-256 mit META_LEADS_APP_SECRET (sonst META_APP_SECRET) prüfen, je leadgen_id
 *        Firma über lead_quellen (art = meta, config.page_id / form_ids) finden, Daten per Graph API holen.
 * Seiten-Token kommt nur aus Env (META_LEADS_ACCESS_TOKEN oder META_PAGE_TOKEN_* je Quelle).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function appSecret(): string | null {
  return process.env.META_LEADS_APP_SECRET || process.env.META_APP_SECRET || null;
}

export function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const erwartet = process.env.META_LEADS_VERIFY_TOKEN;
  if (!erwartet) return new NextResponse("Nicht eingerichtet", { status: 503 });
  if (p.get("hub.mode") === "subscribe" && gleichSicher(p.get("hub.verify_token"), erwartet)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const roh = await request.text();
  const db = createAdminClient();
  const secret = appSecret();
  if (!secret) {
    await db.from("webhook_errors").insert({ endpoint: "meta-leads", payload: null, error: "META_LEADS_APP_SECRET/META_APP_SECRET fehlt" });
    return NextResponse.json({ error: "Nicht eingerichtet" }, { status: 503 });
  }
  if (!metaSignaturGueltig(roh, request.headers.get("x-hub-signature-256"), secret)) {
    await db.from("webhook_errors").insert({ endpoint: "meta-leads", payload: null, error: "Signatur ungültig" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(roh);
  } catch {
    await db.from("webhook_errors").insert({ endpoint: "meta-leads", payload: { roh: roh.slice(0, 5000) }, error: "Kein JSON" });
    return NextResponse.json({ ok: true });
  }

  const aenderungen = leseMetaAenderungen(body);
  if (!aenderungen.length) return NextResponse.json({ ok: true, leads: 0 });

  const { data, error } = await db.from("lead_quellen").select("*").eq("art", "meta");
  if (error) {
    await db.from("webhook_errors").insert({ endpoint: "meta-leads", payload: body as object, error: `Quellen laden: ${error.message}` });
    // 500 → Meta stellt erneut zu
    return NextResponse.json({ error: "Vorübergehender Fehler" }, { status: 500 });
  }
  const quellen = (data ?? []) as LeadQuelleZeile[];

  const ergebnisse: Array<{ leadgen_id: string; status: string; id?: string | null }> = [];
  for (const a of aenderungen) {
    try {
      ergebnisse.push(await verarbeite(db, quellen, a));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await protokolliere(db, { quelle_id: null, company_id: null, status: "fehler", payload: { aenderung: a }, fehler: msg.slice(0, 1000) });
      ergebnisse.push({ leadgen_id: a.leadgenId, status: "fehler" });
    }
  }
  // Immer 200, sobald die Signatur stimmt – Fehler stehen im Protokoll (sonst deaktiviert Meta den Webhook)
  return NextResponse.json({ ok: true, ergebnisse });
}

async function verarbeite(
  db: ReturnType<typeof createAdminClient>,
  quellen: LeadQuelleZeile[],
  a: MetaAenderung,
): Promise<{ leadgen_id: string; status: string; id?: string | null }> {
  const treffer = metaTreffer(quellen, a.pageId, a.formId);
  if (treffer.length > 1) {
    await protokolliere(db, {
      quelle_id: null,
      company_id: null,
      status: "fehler",
      payload: { aenderung: a, quellen: treffer.map((q) => ({ id: q.id, company_id: q.company_id })) },
      fehler: `Zuordnung mehrdeutig: ${treffer.length} aktive Eingänge für Meta-Seite ${a.pageId ?? "?"}${a.formId ? ` / Formular ${a.formId}` : ""} – nichts gespeichert, Formular-IDs eindeutig verteilen`,
    });
    return { leadgen_id: a.leadgenId, status: "fehler" };
  }
  const quelle = treffer[0] ?? null;
  if (!quelle) {
    const aus = metaZuordnung(quellen.map((q) => ({ ...q, aktiv: true })), a.pageId, a.formId);
    await protokolliere(db, {
      quelle_id: aus?.id ?? null,
      company_id: aus?.company_id ?? null,
      status: aus ? "abgelehnt" : "fehler",
      payload: { aenderung: a },
      fehler: aus
        ? "Eingang ist ausgeschaltet"
        : `Keine Firma für Meta-Seite ${a.pageId ?? "?"}${a.formId ? ` / Formular ${a.formId}` : ""} – Quelle mit dieser Seiten-ID anlegen`,
    });
    return { leadgen_id: a.leadgenId, status: aus ? "abgelehnt" : "fehler" };
  }

  const basis = { quelle_id: quelle.id, company_id: quelle.company_id };
  const envName = metaTokenEnvName(quelle.config);
  const token = process.env[envName];
  if (!token) {
    await protokolliere(db, { ...basis, status: "fehler", payload: { aenderung: a }, fehler: `Kein Meta-Zugriffstoken: Env-Variable ${envName} fehlt – Lead ${a.leadgenId} im Meta-Werbeanzeigenmanager abrufen` });
    return { leadgen_id: a.leadgenId, status: "fehler" };
  }

  const g = await holeMetaLead(a.leadgenId, token);
  if ("fehler" in g) {
    await protokolliere(db, { ...basis, status: "fehler", payload: { aenderung: a }, fehler: g.fehler.slice(0, 1000) });
    return { leadgen_id: a.leadgenId, status: "fehler" };
  }

  const lead = leseMetaLead(g.daten, a);
  const r = await speichereLead(db, quelle, lead, { aenderung: a, lead: g.daten });
  if (r.status === "ok") after(() => emailAnBetrieb(db, quelle.company_id, lead, r.eingangId));
  return { leadgen_id: a.leadgenId, status: r.status, id: r.leadId };
}
