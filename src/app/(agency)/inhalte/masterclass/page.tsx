import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Lock, Plus } from "lucide-react";
import { requireTeam } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { ladeKatalog } from "@/lib/masterclass/daten";
import { lektionenVon, sortiereModule } from "@/lib/masterclass/logik";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { modulAnlegen, modulVerschieben } from "./actions";
import { EditorKopf, HochRunter, StatusPille } from "./editor-kopf";

export const metadata: Metadata = { title: "Masterclass-Editor" };
export const dynamic = "force-dynamic";

export default async function MasterclassEditorPage({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  await requireTeam();
  const { fehler } = await searchParams;
  const { module, lektionen } = await ladeKatalog(createAdminClient());
  const sortiert = sortiereModule(module);
  const titel = new Map(module.map((m) => [m.id, m.titel]));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <EditorKopf aktiv="inhalte" fehler={fehler} />

      <form action={modulAnlegen} className="fern-card flex flex-col gap-2 p-4 sm:flex-row">
        <Input name="titel" required maxLength={200} placeholder="Neues Modul, z. B. „Das erste Telefonat“" className="h-11" />
        <Button type="submit" className="h-11">
          <Plus /> Modul anlegen
        </Button>
      </form>

      {sortiert.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Module.</p>
      ) : (
        <ul className="space-y-2">
          {sortiert.map((m, i) => {
            const ls = lektionenVon(m.id, lektionen);
            const live = ls.filter((l) => l.status === "veroeffentlicht").length;
            return (
              <li key={m.id} className="fern-card flex items-center gap-3 p-3 pr-4">
                <HochRunter aktion={modulVerschieben} felder={{ id: m.id }} erster={i === 0} letzter={i === sortiert.length - 1} />
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {i + 1}
                </span>
                <Link href={`/inhalte/masterclass/modul/${m.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{m.titel}</span>
                      <StatusPille status={m.status} />
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {ls.length} Lektionen · {live} veröffentlicht
                      {m.voraussetzung_course_id && (
                        <span className="ml-2 inline-flex items-center gap-1">
                          <Lock className="h-3 w-3" /> erst nach „{titel.get(m.voraussetzung_course_id) ?? "?"}“
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
