import type { Metadata } from "next";
import { Hourglass } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { basisUrl } from "@/lib/zugaenge";
import { zeitpunktText } from "@/lib/crm/logik";
import { ladeKalenderAbo } from "@/lib/kalender/daten";
import { aboLinks } from "@/lib/kalender/logik";
import { KalenderAnsicht } from "./kalender-ansicht";

export const metadata: Metadata = { title: "Kalender" };
export const dynamic = "force-dynamic";

export default async function KalenderPage() {
  const ctx = await requireKunde();
  const db = createAdminClient();
  const { fehlt, abo } = await ladeKalenderAbo(db, ctx.companyId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="fern-page-title">Kalender verbinden</h1>
        <p className="text-sm text-muted-foreground">Termine und Rückrufe automatisch in deinem Handy-Kalender.</p>
      </div>

      {fehlt ? (
        <section className="fern-card flex items-center gap-3 p-6">
          <Hourglass className="size-6 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-base font-semibold">Wird eingerichtet</p>
            <p className="text-sm text-muted-foreground">Dieser Bereich ist gleich für dich da. Schau bald nochmal rein.</p>
          </div>
        </section>
      ) : (
        <KalenderAnsicht
          links={abo?.token ? aboLinks(await basisUrl(), abo.token, `${ctx.company.name} – Anfragen & Termine`) : null}
          letzterAbruf={abo?.letzter_abruf_am ? zeitpunktText(abo.letzter_abruf_am) : null}
          buchungslink={abo?.buchungslink ?? ""}
        />
      )}
    </div>
  );
}
