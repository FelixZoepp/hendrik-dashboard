import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gleichSicher, istToken, leseBody, leseGoogle, leseMapping, lesePerspective, leseWebhook, type EingangLead } from "@/lib/eingang/logik";
import { emailAnBetrieb, protokolliere, speichereLead, type LeadQuelleZeile } from "@/lib/eingang/verarbeitung";

/**
 * Lead-Eingang je Handwerksbetrieb: POST /api/webhooks/leads/<token>
 * Token → Quelle (lead_quellen) → Parser je Art (perspective | google | webhook) → public.leads.
 * Meta-Leadformulare laufen zentral über /api/webhooks/meta-leads.
 * Jeder Aufruf mit gültigem Token steht im Protokoll lead_eingang (Team: Kunde → Lead-Eingänge).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 256 * 1024;

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

async function leseAnfrage(request: NextRequest): Promise<{ body: Record<string, unknown> | null; roh: string }> {
  const typ = request.headers.get("content-type") ?? "";
  if (typ.includes("multipart/form-data")) {
    const fd = await request.formData();
    const body: Record<string, unknown> = {};
    for (const [k, v] of fd) if (typeof v === "string") body[k] = v;
    return { body: Object.keys(body).length ? body : null, roh: "" };
  }
  const roh = await request.text();
  return { body: roh.length > MAX_BODY ? null : leseBody(roh), roh };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!istToken(token)) return NextResponse.json({ ok: false, error: "Unbekannter Eingang" }, { status: 404 });

  const db = createAdminClient();
  const { data, error } = await db.from("lead_quellen").select("*").eq("token", token).maybeSingle();
  if (error) {
    await db.from("webhook_errors").insert({ endpoint: "lead-eingang", payload: null, error: `Quelle laden: ${error.message}` });
    return NextResponse.json({ ok: false, error: "Vorübergehender Fehler" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ ok: false, error: "Unbekannter Eingang" }, { status: 404 });
  const quelle = data as LeadQuelleZeile;
  const basis = { quelle_id: quelle.id, company_id: quelle.company_id };

  let body: Record<string, unknown> | null = null;
  let roh = "";
  try {
    ({ body, roh } = await leseAnfrage(request));
  } catch (err) {
    roh = `Body nicht lesbar: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!quelle.aktiv) {
    await protokolliere(db, { ...basis, status: "abgelehnt", payload: body ?? { roh: roh.slice(0, 5000) }, fehler: "Eingang ist ausgeschaltet" });
    return NextResponse.json({ ok: false, error: "Eingang ist ausgeschaltet" }, { status: 403 });
  }
  if (!body) {
    const fehler = roh.length > MAX_BODY ? "Body zu groß" : "Body ist weder JSON noch Formular";
    await protokolliere(db, { ...basis, status: "fehler", payload: { roh: roh.slice(0, 5000) }, fehler });
    return NextResponse.json({ ok: false, error: fehler }, { status: 400 });
  }

  try {
    let lead: EingangLead;
    switch (quelle.art) {
      case "perspective":
        lead = lesePerspective(body);
        break;
      case "google": {
        const g = leseGoogle(body);
        const erwartet = typeof quelle.config?.key === "string" ? quelle.config.key : null;
        if (!gleichSicher(g.googleKey, erwartet)) {
          const { google_key: _schluessel, ...ohneSchluessel } = body;
          void _schluessel;
          await protokolliere(db, { ...basis, status: "abgelehnt", payload: ohneSchluessel, fehler: "Google-Schlüssel (google_key) falsch oder fehlt" });
          return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
        lead = g.lead;
        // Schlüssel nicht im Lead speichern
        delete body.google_key;
        break;
      }
      case "webhook":
        lead = leseWebhook(body, leseMapping(quelle.config?.mapping));
        break;
      default:
        await protokolliere(db, { ...basis, status: "abgelehnt", payload: body, fehler: "Meta-Leads kommen über /api/webhooks/meta-leads, nicht über diese URL" });
        return NextResponse.json({ ok: false, error: "Falscher Eingang für Meta" }, { status: 400 });
    }

    const r = await speichereLead(db, quelle, lead, body);
    if (r.status === "ok") after(() => emailAnBetrieb(db, quelle.company_id, lead, r.eingangId));

    if (r.status === "ok") return NextResponse.json({ ok: true, id: r.leadId });
    if (r.status === "duplikat") return NextResponse.json({ ok: true, id: r.leadId, duplikat: true });
    return NextResponse.json({ ok: false, error: r.fehler }, { status: r.nochmal ? 500 : 422 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await protokolliere(db, { ...basis, status: "fehler", payload: body, fehler: msg.slice(0, 1000) });
    await db.from("webhook_errors").insert({ endpoint: "lead-eingang", payload: body, error: msg });
    return NextResponse.json({ ok: false, error: "Interner Fehler" }, { status: 500 });
  }
}
