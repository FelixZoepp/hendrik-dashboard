import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gleichSicher } from "@/lib/eingang/logik";
import { basisUrl } from "@/lib/zugaenge";
import { aboPerToken, ladeFeedDaten } from "@/lib/kalender/daten";
import { icsFeed, tokenAusSegment } from "@/lib/kalender/logik";

export const dynamic = "force-dynamic";

/** Abruf-Zeitpunkt höchstens alle 10 Minuten speichern (Kalender fragen oft nach). */
const ABRUF_MERKEN_MS = 10 * 60_000;

function nichtGefunden() {
  return new NextResponse("Kalender nicht gefunden", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

/**
 * Kalender-Abo (ICS) einer Firma: /api/kalender/<token>.ics — öffentlich (Google/Apple/Outlook holen ohne Login).
 * Der Token ist das einzige Geheimnis; „Neuen Link erzeugen“ macht den alten sofort ungültig.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: segment } = await params;
  const token = tokenAusSegment(segment);
  if (!token) return nichtGefunden();

  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    return nichtGefunden();
  }

  const abo = await aboPerToken(db, token);
  if (!abo || !gleichSicher(abo.token, token)) return nichtGefunden();

  const [firmaRes, daten] = await Promise.all([
    db.from("companies").select("name").eq("id", abo.companyId).maybeSingle(),
    ladeFeedDaten(db, abo.companyId),
  ]);

  const jetzt = new Date();
  if (!abo.letzterAbruf || jetzt.getTime() - Date.parse(abo.letzterAbruf) > ABRUF_MERKEN_MS) {
    const { error } = await db
      .from("kalender_abos")
      .update({ letzter_abruf_am: jetzt.toISOString(), abrufe: abo.abrufe + 1 })
      .eq("company_id", abo.companyId)
      .eq("token", token);
    if (error) console.warn(`[kalender] Abruf merken: ${error.message}`);
  }

  const ics = icsFeed({
    firmenName: (firmaRes.data as { name: string } | null)?.name ?? "",
    basisUrl: await basisUrl(),
    termine: daten.termine,
    rueckrufe: daten.rueckrufe,
    jetzt,
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="anfragen-termine.ics"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
