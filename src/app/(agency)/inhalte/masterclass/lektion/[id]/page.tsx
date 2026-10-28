import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye, ListChecks, Plus, Trash2 } from "lucide-react";
import { requireTeam } from "@/lib/kontext";
import { istUuid } from "@/lib/zugriff";
import { createAdminClient } from "@/lib/supabase/admin";
import { ladeAufgaben, ladeKatalog } from "@/lib/masterclass/daten";
import { sortiereModule } from "@/lib/masterclass/logik";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aufgabeLoeschen, aufgabeSpeichern, aufgabeVerschieben, lektionLoeschen } from "../../actions";
import { EditorKopf, HochRunter, StatusPille } from "../../editor-kopf";
import { AnhaengeEditor } from "./anhaenge-editor";
import { LektionFormular } from "./lektion-formular";

export const metadata: Metadata = { title: "Lektion bearbeiten" };
export const dynamic = "force-dynamic";

export default async function LektionEditorPage({
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
  const lektion = lektionen.find((l) => l.id === id);
  if (!lektion) notFound();
  const modul = module.find((m) => m.id === lektion.course_id);
  const aufgaben = await ladeAufgaben(db, [id]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <EditorKopf aktiv="inhalte" fehler={fehler}>
        <Button variant="outline" render={<Link href={`/inhalte/masterclass/lektion/${id}/vorschau`} />}>
          <Eye /> Vorschau
        </Button>
      </EditorKopf>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/inhalte/masterclass/modul/${lektion.course_id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {modul?.titel ?? "Modul"}
        </Link>
        {modul && <StatusPille status={modul.status} />}
      </div>

      <LektionFormular lektion={lektion} module={sortiereModule(module).map((m) => ({ id: m.id, titel: m.titel }))} />

      <AnhaengeEditor lessonId={id} anfang={lektion.anhaenge} />

      <div className="fern-card space-y-4 p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ListChecks className="h-5 w-5 text-primary" /> Aufgaben zum Abhaken
        </h2>
        {aufgaben.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Aufgaben.</p>}
        <ul className="space-y-2">
          {aufgaben.map((a, i) => (
            <li key={a.id} className="flex items-start gap-2 rounded-xl bg-muted/60 p-2">
              <HochRunter
                aktion={aufgabeVerschieben}
                felder={{ id: a.id, lesson_id: id }}
                erster={i === 0}
                letzter={i === aufgaben.length - 1}
              />
              <form action={aufgabeSpeichern} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="lesson_id" value={id} />
                <Input name="titel" required defaultValue={a.titel} maxLength={300} />
                <Input name="beschreibung" defaultValue={a.beschreibung ?? ""} placeholder="Hinweis (optional)" maxLength={1000} />
                <Button type="submit" variant="outline" size="sm" className="h-8">
                  Speichern
                </Button>
              </form>
              <form action={aufgabeLoeschen}>
                <input type="hidden" name="id" value={a.id} />
                <Button type="submit" variant="ghost" size="icon" aria-label="Aufgabe löschen">
                  <Trash2 className="text-destructive" />
                </Button>
              </form>
            </li>
          ))}
        </ul>
        <form action={aufgabeSpeichern} className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
          <input type="hidden" name="lesson_id" value={id} />
          <Input name="titel" required maxLength={300} placeholder="Neue Aufgabe" />
          <Input name="beschreibung" maxLength={1000} placeholder="Hinweis (optional)" />
          <Button type="submit">
            <Plus /> Hinzufügen
          </Button>
        </form>
      </div>

      {lektion.status === "entwurf" && (
        <form action={lektionLoeschen}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="ghost" className="text-destructive">
            <Trash2 /> Entwurf löschen
          </Button>
        </form>
      )}
    </div>
  );
}
