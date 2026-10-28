import type { Metadata } from "next";
import { Lock, Unlock } from "lucide-react";
import { requireTeam } from "@/lib/kontext";
import { istUuid } from "@/lib/zugriff";
import { createAdminClient } from "@/lib/supabase/admin";
import { ladeFreischaltungen, ladeKatalog } from "@/lib/masterclass/daten";
import { modulSperren, sichtbarerKatalog, sortiereModule } from "@/lib/masterclass/logik";
import { Button } from "@/components/ui/button";
import { AUSWAHL_KLASSE } from "@/components/zugaenge/stil";
import { cn } from "@/lib/utils";
import { freischaltungSetzen } from "../actions";
import { EditorKopf, StatusPille } from "../editor-kopf";

export const metadata: Metadata = { title: "Masterclass-Freischaltung" };
export const dynamic = "force-dynamic";

const WERTE = [
  { wert: "standard", label: "Standard" },
  { wert: "frei", label: "Freischalten" },
  { wert: "gesperrt", label: "Sperren" },
] as const;

export default async function FreischaltungPage({ searchParams }: { searchParams: Promise<{ firma?: string; fehler?: string }> }) {
  await requireTeam();
  const { firma, fehler } = await searchParams;
  const db = createAdminClient();
  const [{ data: firmen }, katalog] = await Promise.all([
    db.from("companies").select("id, name, status").order("name"),
    ladeKatalog(db),
  ]);
  const liste = (firmen ?? []) as { id: string; name: string; status: string }[];
  const gewaehlt = istUuid(firma) ? liste.find((f) => f.id === firma) ?? null : null;

  let inhalt: React.ReactNode = (
    <p className="text-sm text-muted-foreground">
      Standard: Alle veröffentlichten Module sind für jede Firma frei – außer ein Modul ist auf „erst nach Modul …“ gestellt. Hier kannst du
      je Firma gezielt sperren oder vorzeitig freischalten.
    </p>
  );

  if (gewaehlt) {
    const [freischaltungen, { data: personen }] = await Promise.all([
      ladeFreischaltungen(db, gewaehlt.id),
      db.from("profiles").select("id").eq("company_id", gewaehlt.id),
    ]);
    const ids = ((personen ?? []) as { id: string }[]).map((p) => p.id);
    const { data: fortschritt } = ids.length
      ? await db.from("lesson_progress").select("lesson_id").in("user_id", ids)
      : { data: [] };
    const erledigt = new Set(((fortschritt ?? []) as { lesson_id: string }[]).map((r) => r.lesson_id));
    const sichtbar = sichtbarerKatalog(katalog.module, katalog.lektionen);
    const sperren = modulSperren(sichtbar.module, sichtbar.lektionen, erledigt, freischaltungen);

    inhalt = (
      <ul className="space-y-2">
        {sortiereModule(katalog.module).map((m) => {
          const eintrag = freischaltungen[m.id];
          const aktuell = eintrag === true ? "frei" : eintrag === false ? "gesperrt" : "standard";
          const s = sperren.get(m.id);
          return (
            <li key={m.id} className="fern-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.titel}</span>
                  <StatusPille status={m.status} />
                </div>
                <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                  {m.status === "entwurf" ? (
                    "Entwurf – für Kunden ohnehin unsichtbar"
                  ) : s?.gesperrt ? (
                    <>
                      <Lock className="h-3.5 w-3.5" /> Für {gewaehlt.name} gesperrt: {s.hinweis}
                    </>
                  ) : (
                    <>
                      <Unlock className="h-3.5 w-3.5" /> Für {gewaehlt.name} frei
                    </>
                  )}
                </p>
              </div>
              <div className="flex gap-1 rounded-full bg-muted p-1">
                {WERTE.map((w) => (
                  <form key={w.wert} action={freischaltungSetzen}>
                    <input type="hidden" name="company_id" value={gewaehlt.id} />
                    <input type="hidden" name="course_id" value={m.id} />
                    <input type="hidden" name="wert" value={w.wert} />
                    <button
                      type="submit"
                      className={cn(
                        "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                        aktuell === w.wert ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {w.label}
                    </button>
                  </form>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <EditorKopf aktiv="freischaltung" fehler={fehler} />
      <form method="get" className="fern-card flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
        <label htmlFor="firma" className="text-sm font-medium sm:w-32">
          Firma
        </label>
        <select id="firma" name="firma" defaultValue={gewaehlt?.id ?? ""} className={cn(AUSWAHL_KLASSE, "h-10")}>
          <option value="">Bitte wählen…</option>
          {liste.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.status !== "aktiv" ? ` (${f.status})` : ""}
            </option>
          ))}
        </select>
        <Button type="submit" className="h-10">
          Anzeigen
        </Button>
      </form>
      {inhalt}
    </div>
  );
}
