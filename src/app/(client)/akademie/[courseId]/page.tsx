import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ChevronRight, Clock, FileText, Lock, PlayCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { istUuid } from "@/lib/zugriff";
import { ladeKundenStand } from "@/lib/masterclass/daten";
import { lektionenVon, modulFortschritt, nachKapiteln } from "@/lib/masterclass/logik";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Masterclass" };

/** Modulseite (alte Akademie-Links /akademie/<kurs-id> bleiben gültig). */
export default async function ModulPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const ctx = await requireKunde();
  if (!istUuid(courseId)) notFound();
  const stand = await ladeKundenStand(createAdminClient(), ctx);
  const modul = stand.module.find((m) => m.id === courseId);
  if (!modul) notFound();

  const sperre = stand.modulSperre.get(modul.id);
  const lektionen = lektionenVon(modul.id, stand.lektionen);
  const p = modulFortschritt(modul.id, stand.lektionen, stand.erledigt);
  const erste = lektionen.find((l) => !stand.erledigt.has(l.id) && !stand.lektionSperre.get(l.id)?.gesperrt);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/akademie"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Alle Module
      </Link>

      <div>
        <h1 className="fern-page-title">{modul.titel}</h1>
        {modul.beschreibung && <p className="mt-2 text-base text-muted-foreground">{modul.beschreibung}</p>}
        <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {p.erledigt}/{p.gesamt} Lektionen erledigt
          </span>
          <div className="h-2 max-w-48 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${p.prozent}%` }} />
          </div>
        </div>
      </div>

      {sperre?.gesperrt ? (
        <div className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-4 text-base">
          <Lock className="h-5 w-5 shrink-0 text-muted-foreground" />
          <p>{sperre.hinweis}</p>
        </div>
      ) : (
        erste && (
          <Link
            href={`/akademie/lektion/${erste.id}`}
            className="fern-btn-primary inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full px-6 text-base font-semibold text-white sm:w-auto"
          >
            <PlayCircle className="h-5 w-5" />
            {p.erledigt ? "Weitermachen" : "Modul starten"}
          </Link>
        )
      )}

      {lektionen.length === 0 ? (
        <p className="text-base text-muted-foreground">Lektionen folgen in Kürze.</p>
      ) : (
        nachKapiteln(lektionen).map((g, gi) => (
          <section key={`${g.kapitel ?? "ohne"}-${gi}`} className="space-y-2">
            {g.kapitel && <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.kapitel}</h2>}
            <div className="fern-card divide-y divide-border overflow-hidden">
              {g.lektionen.map((l) => {
                const done = stand.erledigt.has(l.id);
                const s = stand.lektionSperre.get(l.id);
                const inhalt = (
                  <>
                    <span
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                        done ? "bg-success text-white" : "ring-1 ring-border ring-inset",
                      )}
                    >
                      {done ? (
                        <Check className="h-4 w-4" />
                      ) : s?.gesperrt ? (
                        <Lock className="h-4 w-4 text-muted-foreground" />
                      ) : l.typ === "text" ? (
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <PlayCircle className="h-4 w-4 text-primary" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-base font-medium", done && "text-muted-foreground")}>{l.titel}</span>
                      {s?.gesperrt ? (
                        <span className="block text-sm text-muted-foreground">{s.hinweis}</span>
                      ) : l.beschreibung ? (
                        <span className="block truncate text-sm text-muted-foreground">{l.beschreibung}</span>
                      ) : null}
                    </span>
                    {l.dauer ? (
                      <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" /> {l.dauer} Min.
                      </span>
                    ) : null}
                    {!s?.gesperrt && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
                  </>
                );
                return s?.gesperrt ? (
                  <div key={l.id} className="flex min-h-16 items-center gap-3 px-4 py-3 opacity-70">
                    {inhalt}
                  </div>
                ) : (
                  <Link
                    key={l.id}
                    href={`/akademie/lektion/${l.id}`}
                    className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                  >
                    {inhalt}
                  </Link>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
