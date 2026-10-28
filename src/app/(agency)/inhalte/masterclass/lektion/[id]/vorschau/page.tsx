import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTeam } from "@/lib/kontext";
import { istUuid } from "@/lib/zugriff";
import { createAdminClient } from "@/lib/supabase/admin";
import { ladeKatalog } from "@/lib/masterclass/daten";
import { lektionAnsichtDaten } from "@/lib/masterclass/ansicht";
import { lernreihenfolge } from "@/lib/masterclass/logik";
import { LektionAnsicht } from "@/components/masterclass/lektion-ansicht";

export const metadata: Metadata = { title: "Vorschau" };
export const dynamic = "force-dynamic";

/** Editor-Vorschau: zeigt auch Entwürfe, speichert nichts. */
export default async function LektionVorschauPage({ params }: { params: Promise<{ id: string }> }) {
  await requireTeam();
  const { id } = await params;
  if (!istUuid(id)) notFound();
  const db = createAdminClient();
  const { module, lektionen } = await ladeKatalog(db);
  const lektion = lektionen.find((l) => l.id === id);
  const modul = lektion && module.find((m) => m.id === lektion.course_id);
  if (!lektion || !modul) notFound();

  const daten = await lektionAnsichtDaten(db, {
    lektion,
    modul,
    lektionen,
    geordnet: lernreihenfolge(module, lektionen),
    erledigt: new Set(),
  });

  return (
    <LektionAnsicht
      {...daten}
      modus="vorschau"
      lektionLink="/inhalte/masterclass/lektion/:id/vorschau"
      zurueck={{ href: `/inhalte/masterclass/lektion/${id}`, label: "Zurück zum Editor" }}
    />
  );
}
