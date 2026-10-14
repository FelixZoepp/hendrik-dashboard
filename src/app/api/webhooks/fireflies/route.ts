import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { analysiereGespraech, kiAktiv } from "@/lib/gespraeche/analyse";
import { verarbeiteFertigMeldung } from "@/lib/gespraeche/ablauf";
import { signaturOk } from "@/lib/gespraeche/signatur";

// Fireflies-Webhook „Transkript fertig“ (V1: meetingId/clientReferenceId, V2: meeting_id/client_reference_id).
// Die Meldung ist nur Auslöser: Das Transkript wird immer per API geholt und muss im Titel die call_id tragen.
// Transkript holen + KI-Analyse laufen nach der Antwort weiter.

export const maxDuration = 300;

export async function POST(req: Request) {
  const roh = await req.text();
  const secret = process.env.FIREFLIES_WEBHOOK_SECRET;
  const signatur = req.headers.get("x-hub-signature");
  // Signatur prüfen, sobald Fireflies eine mitschickt und das Secret hinterlegt ist
  if (secret && signatur && !signaturOk(roh, signatur, secret)) {
    return NextResponse.json({ error: "Ungültige Signatur" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(roh);
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body" }, { status: 400 });
  }
  const event = String(body.eventType ?? body.event ?? "");
  const meetingId = String(body.meetingId ?? body.meeting_id ?? "");
  const callId = String(body.clientReferenceId ?? body.client_reference_id ?? "");
  if (!meetingId || !/^acti_[A-Za-z0-9]+$/.test(callId)) return NextResponse.json({ ok: true, ignoriert: "keine Zuordnung" });
  if (event && !/transcri|completed|summar/i.test(event)) return NextResponse.json({ ok: true, ignoriert: event });

  after(async () => {
    const svc = createAdminClient();
    try {
      const r = await verarbeiteFertigMeldung(svc, callId, meetingId);
      if (r === "transkribiert" && kiAktiv()) await analysiereGespraech(svc, callId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await svc.from("webhook_errors").insert({ endpoint: "fireflies", payload: { callId, meetingId, event }, error: message });
    }
  });
  return NextResponse.json({ ok: true });
}
