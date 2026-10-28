"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileText,
  Link2,
  Lock,
  Paperclip,
  PlayCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Zeitmarke } from "@/lib/masterclass/logik";
import { VideoPlayer } from "./video-player";

export interface SeitenleisteLektion {
  id: string;
  titel: string;
  typ: "video" | "text";
  dauer: number | null;
  erledigt: boolean;
  gesperrt: boolean;
}

export interface LektionAnsichtProps {
  lektion: {
    id: string;
    titel: string;
    beschreibung: string | null;
    typ: "video" | "text";
    video_url: string | null;
    /** Bereits serverseitig gefiltert (bereinigeHtml) */
    html: string | null;
    dauer: number | null;
    zeitmarken: Zeitmarke[];
  };
  modul: { id: string; titel: string };
  seitenleiste: { kapitel: string | null; lektionen: SeitenleisteLektion[] }[];
  anhaenge: { name: string; href: string; datei: boolean }[];
  aufgaben: { id: string; titel: string; beschreibung: string | null; erledigt: boolean }[];
  erledigt: boolean;
  vorher: { id: string; titel: string } | null;
  nachher: { id: string; titel: string } | null;
  /** kunde = speichert, ansicht = „Als Kunde ansehen“ (nur lesen), vorschau = Editor */
  modus: "kunde" | "ansicht" | "vorschau";
  /** Link-Vorlage für Lektionen, „:id“ wird ersetzt */
  lektionLink: string;
  zurueck: { href: string; label: string };
  speichereLektion?: (lessonId: string, erledigt: boolean) => Promise<{ fehler: string | null }>;
  speichereAufgabe?: (taskId: string, erledigt: boolean) => Promise<{ fehler: string | null }>;
}

export function LektionAnsicht(p: LektionAnsichtProps) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [erledigt, setErledigt] = useOptimistic(p.erledigt);
  const [aufgaben, setAufgabe] = useOptimistic(p.aufgaben, (alt, [id, wert]: [string, boolean]) =>
    alt.map((a) => (a.id === id ? { ...a, erledigt: wert } : a)),
  );
  const link = (id: string) => p.lektionLink.replace(":id", id);
  const kannSpeichern = p.modus === "kunde" && !!p.speichereLektion;

  function umschalten() {
    if (!kannSpeichern || !p.speichereLektion) {
      toast.info(p.modus === "vorschau" ? "Vorschau – hier wird nichts gespeichert." : "Vorschau als Kunde – Fortschritt wird nicht gespeichert.");
      return;
    }
    const neu = !erledigt;
    const speichern = p.speichereLektion;
    starte(async () => {
      setErledigt(neu);
      const r = await speichern(p.lektion.id, neu);
      if (r.fehler) {
        toast.error(r.fehler);
        return;
      }
      if (neu) {
        toast.success("Lektion erledigt – stark!");
        if (p.nachher) router.push(link(p.nachher.id));
        else router.refresh();
      } else {
        router.refresh();
      }
    });
  }

  function aufgabeUmschalten(id: string, wert: boolean) {
    if (!kannSpeichern || !p.speichereAufgabe) {
      toast.info("Vorschau – Haken werden nicht gespeichert.");
      return;
    }
    const speichern = p.speichereAufgabe;
    starte(async () => {
      setAufgabe([id, wert]);
      const r = await speichern(id, wert);
      if (r.fehler) toast.error(r.fehler);
      router.refresh();
    });
  }

  const erledigtKnopf = (
    <button
      type="button"
      onClick={umschalten}
      disabled={laeuft}
      className={cn(
        "inline-flex h-14 w-full items-center justify-center gap-2 rounded-full text-base font-semibold transition-colors disabled:opacity-60",
        erledigt
          ? "bg-success/10 text-success ring-1 ring-success/30 ring-inset hover:bg-success/15"
          : "fern-btn-primary text-white hover:opacity-95",
      )}
    >
      <Check className="h-5 w-5" />
      {erledigt ? "Erledigt – als offen markieren" : "Als erledigt markieren"}
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {p.modus !== "kunde" && (
        <div className="flex items-start gap-2 rounded-2xl bg-warning/15 px-4 py-3 text-sm text-foreground">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {p.modus === "vorschau"
              ? "Vorschau aus dem Editor – so sieht der Kunde die Lektion. Entwürfe sind für Kunden nicht sichtbar."
              : "Vorschau als Kunde – Fortschritt und Haken werden nicht gespeichert. Angezeigt wird, was die Firma bereits erledigt hat."}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Link
          href={p.zurueck.href}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full pr-3 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {p.zurueck.label}
        </Link>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-primary">{p.modul.titel}</p>
          <h1 className="fern-page-title mt-1 break-words">{p.lektion.titel}</h1>
          {p.lektion.dauer ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" /> {p.lektion.dauer} Minuten
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <NavKnopf href={p.vorher ? link(p.vorher.id) : null} label={p.vorher ? `Zurück: ${p.vorher.titel}` : "Zurück"}>
            <ChevronLeft className="h-5 w-5" />
          </NavKnopf>
          <NavKnopf href={p.nachher ? link(p.nachher.id) : null} label={p.nachher ? `Weiter: ${p.nachher.titel}` : "Weiter"}>
            <ChevronRight className="h-5 w-5" />
          </NavKnopf>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {p.lektion.typ === "video" && (
            <VideoPlayer url={p.lektion.video_url} titel={p.lektion.titel} zeitmarken={p.lektion.zeitmarken} />
          )}

          {/* Handy: Abschließen direkt unter dem Video */}
          <div className="lg:hidden">{erledigtKnopf}</div>

          {(p.lektion.beschreibung || p.lektion.html) && (
            <div className="fern-card p-5 sm:p-6">
              {p.lektion.beschreibung && <p className="text-base leading-relaxed text-muted-foreground">{p.lektion.beschreibung}</p>}
              {p.lektion.html && (
                <div
                  className={cn(
                    "text-[16px] leading-relaxed [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:italic [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-lg [&_h3]:font-semibold [&_hr]:my-5 [&_hr]:border-border [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6",
                    p.lektion.beschreibung && "mt-4 border-t border-border pt-2",
                  )}
                  // Inhalt wird beim Speichern UND beim Anzeigen serverseitig gefiltert (bereinigeHtml)
                  dangerouslySetInnerHTML={{ __html: p.lektion.html }}
                />
              )}
            </div>
          )}

          {aufgaben.length > 0 && (
            <div className="fern-card p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Deine Aufgaben</h2>
              <p className="text-sm text-muted-foreground">Hak ab, was du umgesetzt hast.</p>
              <ul className="mt-3 space-y-2">
                {aufgaben.map((a) => (
                  <li key={a.id}>
                    <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl bg-muted/60 px-4 py-3 hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={a.erledigt}
                        onChange={(e) => aufgabeUmschalten(a.id, e.target.checked)}
                        className="mt-0.5 h-6 w-6 shrink-0 accent-primary"
                      />
                      <span>
                        <span className={cn("block text-base", a.erledigt && "text-muted-foreground line-through")}>{a.titel}</span>
                        {a.beschreibung && <span className="block text-sm text-muted-foreground">{a.beschreibung}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {p.nachher && (
            <Link
              href={link(p.nachher.id)}
              className="fern-card flex min-h-16 items-center gap-3 p-4 transition-colors hover:bg-accent/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Nächste Lektion</span>
                <span className="block truncate text-base font-semibold">{p.nachher.titel}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-primary" />
            </Link>
          )}
        </div>

        <aside className="space-y-5">
          <div className="hidden lg:block">{erledigtKnopf}</div>

          {p.anhaenge.length > 0 && (
            <div className="fern-card p-5">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Paperclip className="h-5 w-5 text-primary" /> Material
              </h2>
              <ul className="mt-3 space-y-2">
                {p.anhaenge.map((a, i) => (
                  <li key={`${a.href}-${i}`}>
                    <a
                      href={a.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-12 items-center gap-3 rounded-2xl bg-muted/60 px-4 py-2 text-base hover:bg-muted"
                    >
                      {a.datei ? <Download className="h-5 w-5 shrink-0 text-primary" /> : <Link2 className="h-5 w-5 shrink-0 text-primary" />}
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="fern-card p-5">
            <h2 className="text-lg font-semibold">{p.modul.titel}</h2>
            <div className="mt-2 space-y-3">
              {p.seitenleiste.map((g, gi) => (
                <div key={`${g.kapitel ?? "ohne"}-${gi}`}>
                  {g.kapitel && (
                    <p className="px-2 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.kapitel}</p>
                  )}
                  <ul className="space-y-1">
                    {g.lektionen.map((x) => {
                      const inhalt = (
                        <>
                          <span
                            className={cn(
                              "grid h-6 w-6 shrink-0 place-items-center rounded-full",
                              x.erledigt ? "bg-success text-white" : "ring-1 ring-border ring-inset",
                            )}
                          >
                            {x.erledigt ? <Check className="h-3.5 w-3.5" /> : x.gesperrt ? <Lock className="h-3 w-3 text-muted-foreground" /> : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">{x.titel}</span>
                          {x.typ === "text" ? (
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : x.dauer ? (
                            <span className="text-xs text-muted-foreground">{x.dauer} Min.</span>
                          ) : (
                            <PlayCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                        </>
                      );
                      const klasse = cn(
                        "flex min-h-11 items-center gap-3 rounded-xl px-2",
                        x.id === p.lektion.id ? "bg-primary/10 text-primary" : "hover:bg-muted",
                        x.gesperrt && x.id !== p.lektion.id && "opacity-60",
                      );
                      return (
                        <li key={x.id}>
                          {x.gesperrt && x.id !== p.lektion.id ? (
                            <span className={klasse}>{inhalt}</span>
                          ) : (
                            <Link href={link(x.id)} className={klasse}>
                              {inhalt}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function NavKnopf({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  return href ? (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className="grid h-12 w-12 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border ring-inset hover:bg-muted"
    >
      {children}
    </Link>
  ) : (
    <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-full opacity-30 ring-1 ring-border ring-inset">
      {children}
    </span>
  );
}
