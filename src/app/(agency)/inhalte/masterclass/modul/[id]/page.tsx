import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, FileText, ListChecks, Paperclip, PlayCircle, Plus, Trash2 } from "lucide-react";
import { requireTeam } from "@/lib/kontext";
import { istUuid } from "@/lib/zugriff";
import { createAdminClient } from "@/lib/supabase/admin";
import { bildLinks, ladeAufgaben, ladeKatalog } from "@/lib/masterclass/daten";
import { lektionenVon, sortiereModule } from "@/lib/masterclass/logik";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lektionAnlegen, lektionVerschieben, modulLoeschen } from "../../actions";
import { EditorKopf, HochRunter, StatusPille } from "../../editor-kopf";
import { ModulFormular } from "./modul-formular";

export const metadata: Metadata = { title: "Modul bearbeiten" };
export const dynamic = "force-dynamic";

export default async function ModulEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fehler?: string }>;
}) {
  await requireTeam();
  const { id } = await params;
  const { fehler } = await searchParams;
  if (!istUuid(id)) notFound();
  const db = createAdminClient();
  const { module, lektionen } = await ladeKatalog(db);
  const modul = module.find((m) => m.id === id);
  if (!modul) notFound();
  const ls = lektionenVon(id, lektionen);
  const [bilder, aufgaben] = await Promise.all([bildLinks(db, [modul]), ladeAufgaben(db, ls.map((l) => l.id))]);
  const aufgabenJe = new Map<string, number>();
  for (const a of aufgaben) aufgabenJe.set(a.lesson_id, (aufgabenJe.get(a.lesson_id) ?? 0) + 1);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <EditorKopf aktiv="inhalte" fehler={fehler} />
      <Link href="/inhalte/masterclass" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Alle Module
      </Link>

      <ModulFormular
        modul={modul}
        andere={sortiereModule(module)
          .filter((m) => m.id !== id)
          .map((m) => ({ id: m.id, titel: m.titel }))}
        bildVorschau={bilder.get(id) ?? null}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Lektionen</h2>
        {ls.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Lektionen.</p>}
        <ul className="space-y-2">
          {ls.map((l, i) => (
            <li key={l.id} className="fern-card flex items-center gap-3 p-3 pr-4">
              <HochRunter
                aktion={lektionVerschieben}
                felder={{ id: l.id, course_id: id }}
                erster={i === 0}
                letzter={i === ls.length - 1}
              />
              <Link href={`/inhalte/masterclass/lektion/${l.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                {l.typ === "text" ? (
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                ) : (
                  <PlayCircle className="h-5 w-5 shrink-0 text-primary" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.titel}</span>
                    <StatusPille status={l.status} />
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {l.kapitel && <span>Kapitel: {l.kapitel}</span>}
                    {l.dauer ? <span>{l.dauer} Min.</span> : null}
                    {l.video_url ? <span>Video ✓</span> : l.typ === "video" ? <span>ohne Video</span> : null}
                    {l.anhaenge.length > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <Paperclip className="h-3 w-3" /> {l.anhaenge.length}
                      </span>
                    )}
                    {aufgabenJe.get(l.id) ? (
                      <span className="inline-flex items-center gap-0.5">
                        <ListChecks className="h-3 w-3" /> {aufgabenJe.get(l.id)}
                      </span>
                    ) : null}
                    {l.freigeschaltet_ab > 0 && <span>ab Tag {l.freigeschaltet_ab}</span>}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
        <form action={lektionAnlegen} className="fern-card flex flex-col gap-2 p-4 sm:flex-row">
          <input type="hidden" name="course_id" value={id} />
          <Input name="titel" required maxLength={200} placeholder="Neue Lektion" className="h-11" />
          <Button type="submit" className="h-11">
            <Plus /> Lektion anlegen
          </Button>
        </form>
      </section>

      {ls.length === 0 && (
        <form action={modulLoeschen}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="ghost" className="text-destructive">
            <Trash2 /> Leeres Modul löschen
          </Button>
        </form>
      )}
    </div>
  );
}
