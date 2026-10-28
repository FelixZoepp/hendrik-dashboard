import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, Eye, GraduationCap, Lock, PlayCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireKunde } from "@/lib/kontext";
import { bildLinks, ladeKundenStand } from "@/lib/masterclass/daten";
import { fortschritt, lektionenVon, modulFortschritt, weiterLektion } from "@/lib/masterclass/logik";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Masterclass" };
export const dynamic = "force-dynamic";

export default async function MasterclassPage() {
  const ctx = await requireKunde();
  const db = createAdminClient();
  const stand = await ladeKundenStand(db, ctx);
  const bilder = await bildLinks(db, stand.module);

  const gesperrt = new Set([...stand.lektionSperre].filter(([, s]) => s.gesperrt).map(([id]) => id));
  const gesamt = fortschritt(stand.geordnet.map((l) => l.id), stand.erledigt);
  const weiter = weiterLektion(stand.geordnet, stand.erledigtAm, gesperrt);
  const modulTitel = new Map(stand.module.map((m) => [m.id, m.titel]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="fern-page-title">Masterclass</h1>
        <p className="text-base text-muted-foreground">Schritt für Schritt zu mehr Aufträgen aus deinen Anfragen.</p>
      </div>

      {ctx.impersoniert && (
        <div className="flex items-start gap-2 rounded-2xl bg-warning/15 px-4 py-3 text-sm">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Vorschau als {ctx.company.name}: Du siehst den Fortschritt der Firma. Hier wird nichts gespeichert.</p>
        </div>
      )}

      {stand.module.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-border bg-card/60 p-12 text-center">
          <GraduationCap className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-base text-muted-foreground">Die Masterclass wird gerade vorbereitet.</p>
        </div>
      ) : (
        <>
          <section className="fern-hero p-6 sm:p-8">
            <p className="text-sm font-medium uppercase tracking-wide text-white/70">Dein Fortschritt</p>
            <h2 className="mt-1 text-2xl font-semibold sm:text-3xl">
              {gesamt.gesamt > 0 && gesamt.erledigt === gesamt.gesamt
                ? "Alles geschafft – stark!"
                : gesamt.erledigt > 0
                  ? "Weiter, wo du warst"
                  : "Los geht’s"}
            </h2>
            <p className="mt-2 text-base text-white/80">
              {gesamt.erledigt} von {gesamt.gesamt} Lektionen erledigt · {gesamt.prozent} %
            </p>
            <div className="mt-4 h-3 max-w-md overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-white" style={{ width: `${gesamt.prozent}%` }} />
            </div>
            {weiter && (
              <Link
                href={`/akademie/lektion/${weiter.id}`}
                className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-white px-6 text-base font-semibold text-primary transition-transform hover:-translate-y-0.5 sm:w-auto"
              >
                <PlayCircle className="h-5 w-5 shrink-0" />
                <span className="min-w-0 truncate">
                  {gesamt.erledigt ? "Weiter mit" : "Starten mit"}: {weiter.titel}
                </span>
              </Link>
            )}
            {weiter && (
              <p className="mt-2 text-sm text-white/70">aus „{modulTitel.get(weiter.course_id)}“</p>
            )}
          </section>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {stand.module.map((m, i) => {
              const p = modulFortschritt(m.id, stand.lektionen, stand.erledigt);
              const sperre = stand.modulSperre.get(m.id);
              const minuten = lektionenVon(m.id, stand.lektionen).reduce((s, l) => s + (l.dauer ?? 0), 0);
              const fertig = p.gesamt > 0 && p.erledigt === p.gesamt;
              const bild = bilder.get(m.id);
              return (
                <Link
                  key={m.id}
                  href={`/akademie/${m.id}`}
                  className={cn(
                    "fern-card flex flex-col overflow-hidden transition-colors hover:bg-accent/50",
                    sperre?.gesperrt && "opacity-75",
                  )}
                >
                  {bild ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signierte Storage-Links, kein next/image-Host
                    <img src={bild} alt="" className="aspect-[16/9] w-full object-cover" />
                  ) : (
                    <div className="fern-hero grid aspect-[16/9] w-full place-items-center rounded-none">
                      <span className="text-5xl font-semibold text-white/90">{i + 1}</span>
                    </div>
                  )}
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start gap-2">
                      <h2 className="min-w-0 flex-1 text-lg font-semibold leading-snug">{m.titel}</h2>
                      {sperre?.gesperrt ? (
                        <Lock className="h-5 w-5 shrink-0 text-muted-foreground" />
                      ) : fertig ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                      ) : null}
                    </div>
                    {m.beschreibung && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{m.beschreibung}</p>}
                    <div className="mt-auto pt-4">
                      {sperre?.gesperrt ? (
                        <p className="text-sm font-medium text-muted-foreground">{sperre.hinweis}</p>
                      ) : (
                        <>
                          <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>
                              {p.erledigt}/{p.gesamt} Lektionen
                            </span>
                            {minuten > 0 && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" /> {minuten} Min.
                              </span>
                            )}
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn("h-full rounded-full", fertig ? "bg-success" : "bg-primary")}
                              style={{ width: `${p.prozent}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
