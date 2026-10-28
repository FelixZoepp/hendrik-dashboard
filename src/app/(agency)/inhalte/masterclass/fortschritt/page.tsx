import type { Metadata } from "next";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { requireTeam } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { ladeKatalog } from "@/lib/masterclass/daten";
import { fortschritt, fortschrittJePerson, lernreihenfolge, sichtbarerKatalog } from "@/lib/masterclass/logik";
import { cn } from "@/lib/utils";
import { EditorKopf } from "../editor-kopf";

export const metadata: Metadata = { title: "Masterclass-Fortschritt" };
export const dynamic = "force-dynamic";

interface Person {
  id: string;
  full_name: string | null;
  email?: string | null;
  role: string;
  company_id: string | null;
}

function Balken({ prozent }: { prozent: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", prozent === 100 ? "bg-success" : "bg-primary")} style={{ width: `${prozent}%` }} />
    </div>
  );
}

const datum = (iso: string | null) => (iso ? format(new Date(iso), "d. MMM yyyy", { locale: de }) : "–");

export default async function FortschrittPage() {
  await requireTeam();
  const db = createAdminClient();
  const [katalog, { data: firmen }, { data: personen }, eintraege] = await Promise.all([
    ladeKatalog(db),
    db.from("companies").select("id, name").order("name"),
    db.from("profiles").select("*").in("role", ["client_owner", "client_member"]).not("company_id", "is", null),
    fetchAll<{ user_id: string; lesson_id: string; abgeschlossen_am: string | null }>(() =>
      db.from("lesson_progress").select("user_id, lesson_id, abgeschlossen_am").order("id"),
    ).catch(() => []),
  ]);
  const sichtbar = sichtbarerKatalog(katalog.module, katalog.lektionen);
  const lektionIds = lernreihenfolge(sichtbar.module, sichtbar.lektionen).map((l) => l.id);
  const alle = (personen ?? []) as Person[];

  const zeilen = ((firmen ?? []) as { id: string; name: string }[])
    .map((f) => {
      const leute = alle.filter((p) => p.company_id === f.id);
      const je = fortschrittJePerson(
        leute.map((p) => p.id),
        eintraege,
        lektionIds,
      );
      const firmaErledigt = new Set(
        eintraege.filter((e) => leute.some((p) => p.id === e.user_id)).map((e) => e.lesson_id),
      );
      return { firma: f, leute, je, gesamt: fortschritt(lektionIds, firmaErledigt) };
    })
    .filter((z) => z.leute.length > 0)
    .sort((a, b) => b.gesamt.prozent - a.gesamt.prozent || a.firma.name.localeCompare(b.firma.name, "de"));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <EditorKopf aktiv="fortschritt" />
      <p className="text-sm text-muted-foreground">
        {lektionIds.length} veröffentlichte Lektionen. Fortschritt je Firma (was irgendeine Person der Firma erledigt hat) und je Person.
      </p>
      {zeilen.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Kunden-Zugänge.</p>
      ) : (
        <div className="space-y-3">
          {zeilen.map(({ firma, leute, je, gesamt }) => (
            <details key={firma.id} className="fern-card group p-4">
              <summary className="flex cursor-pointer list-none items-center gap-4">
                <span className="min-w-0 flex-1 font-medium">{firma.name}</span>
                <span className="w-28 shrink-0 sm:w-48">
                  <Balken prozent={gesamt.prozent} />
                </span>
                <span className="w-20 shrink-0 text-right text-sm text-muted-foreground">
                  {gesamt.erledigt}/{gesamt.gesamt}
                </span>
              </summary>
              <ul className="mt-3 space-y-2 border-t border-border pt-3">
                {je.map((p) => {
                  const person = leute.find((x) => x.id === p.user_id);
                  return (
                    <li key={p.user_id} className="flex items-center gap-4 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {person?.full_name || person?.email || "Unbekannt"}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {person?.role === "client_owner" ? "Inhaber" : "Mitarbeiter"} · zuletzt {datum(p.zuletzt)}
                        </span>
                      </span>
                      <span className="w-28 shrink-0 sm:w-48">
                        <Balken prozent={p.prozent} />
                      </span>
                      <span className="w-20 shrink-0 text-right text-muted-foreground">{p.prozent} %</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
