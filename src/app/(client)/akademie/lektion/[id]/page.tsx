import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { istUuid } from "@/lib/zugriff";
import { ladeErledigteAufgaben, ladeKundenStand } from "@/lib/masterclass/daten";
import { lektionAnsichtDaten } from "@/lib/masterclass/ansicht";
import { LektionAnsicht } from "@/components/masterclass/lektion-ansicht";
import { aufgabeErledigt, lektionErledigt } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lektion" };

export default async function LektionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKunde();
  if (!istUuid(id)) notFound();
  const db = createAdminClient();
  const stand = await ladeKundenStand(db, ctx);
  const lektion = stand.lektionen.find((l) => l.id === id);
  const modul = lektion && stand.module.find((m) => m.id === lektion.course_id);
  if (!lektion || !modul) notFound();

  const sperre = stand.lektionSperre.get(lektion.id);
  if (sperre?.gesperrt) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <Link
          href={`/akademie/${modul.id}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {modul.titel}
        </Link>
        <div className="fern-card p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-3 text-xl font-semibold">{lektion.titel}</h1>
          <p className="mt-2 text-base text-muted-foreground">{sperre.hinweis}</p>
        </div>
      </div>
    );
  }

  const daten = await lektionAnsichtDaten(db, {
    lektion,
    modul,
    lektionen: stand.lektionen,
    geordnet: stand.geordnet,
    erledigt: stand.erledigt,
    sperren: stand.lektionSperre,
    erledigteAufgaben: (ids) => ladeErledigteAufgaben(db, ctx, ids),
  });

  return (
    <LektionAnsicht
      {...daten}
      modus={ctx.impersoniert ? "ansicht" : "kunde"}
      lektionLink="/akademie/lektion/:id"
      zurueck={{ href: `/akademie/${modul.id}`, label: modul.titel }}
      speichereLektion={ctx.impersoniert ? undefined : lektionErledigt}
      speichereAufgabe={ctx.impersoniert ? undefined : aufgabeErledigt}
    />
  );
}
