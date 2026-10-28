import type { Metadata } from "next";
import Link from "next/link";
import { Check, CheckCheck, CircleAlert, Clock, MessagesSquare } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { istFreigeschaltet } from "@/lib/whatsapp/admin";
import { formatDatum, formatUhrzeit } from "@/lib/whatsapp/logik";
import { VORLAGEN } from "@/lib/whatsapp/vorlagen";
import { AutoAktualisieren } from "./auto-aktualisieren";

export const metadata: Metadata = { title: "WhatsApp-Chats" };
export const dynamic = "force-dynamic";

interface Nachricht {
  id: string;
  richtung: "aus" | "ein";
  telefon: string;
  termin_id: string | null;
  typ: string | null;
  vorlage: string | null;
  body: string | null;
  status: string;
  fehler: string | null;
  created_at: string;
}

interface TerminInfo {
  id: string;
  telefon: string | null;
  name: string | null;
  firma: string | null;
  art: string;
  start_at: string;
  status: string;
  bestaetigt_am: string | null;
  verschieben_am: string | null;
  close_lead_id: string | null;
}

interface Chat {
  telefon: string;
  nachrichten: Nachricht[];
  letzte: Nachricht;
  termin: TerminInfo | null;
}

const LIMIT = 2000;
const KNOEPFE = new Map<string, string[]>(VORLAGEN.map((v) => [v.name, v.buttons.map((b) => b.text)]));

const istHeute = (d: Date) => d.toDateString() === new Date().toDateString();
const kurzZeit = (iso: string) => {
  const d = new Date(iso);
  return istHeute(d) ? formatUhrzeit(d) : formatDatum(d);
};

function StatusHaken({ n }: { n: Nachricht }) {
  if (n.richtung === "ein") return null;
  if (n.status === "fehlgeschlagen") return <CircleAlert className="size-3.5 text-destructive" />;
  if (n.status === "gelesen") return <CheckCheck className="size-3.5 text-sky-500" />;
  if (n.status === "zugestellt") return <CheckCheck className="size-3.5 text-muted-foreground" />;
  if (n.status === "gesendet") return <Check className="size-3.5 text-muted-foreground" />;
  return <Clock className="size-3.5 text-muted-foreground" />;
}

function terminStand(t: TerminInfo) {
  if (t.status === "abgesagt") return { text: "abgesagt", farbe: "bg-secondary text-muted-foreground" };
  if (t.bestaetigt_am) return { text: "bestätigt", farbe: "bg-success/15 text-success" };
  if (t.verschieben_am) return { text: "möchte verschieben", farbe: "bg-warning/20 text-warning-foreground" };
  return { text: "unbestätigt", farbe: "bg-secondary text-muted-foreground" };
}

export default async function WhatsappChatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const fehler = typeof sp.fehler === "string" ? sp.fehler : null;
  const frei = await istFreigeschaltet();

  if (!frei) {
    return (
      <div className="space-y-6">
        <h1 className="fern-page-title">WhatsApp-Chats</h1>
        <section className="fern-card max-w-md p-6">
          <p className="mb-4 text-sm text-muted-foreground">
            Die Chats enthalten Kundendaten und sind deshalb nur für Admin und Sales sichtbar.
          </p>
          <p className="text-sm">Nur für Admin und Sales.</p>
          {fehler && <p className="mt-3 text-sm text-destructive">{fehler}</p>}
        </section>
      </div>
    );
  }

  const svc = createAdminClient();
  const { data, error } = await svc
    .from("wa_nachrichten")
    .select("id, richtung, telefon, termin_id, typ, vorlage, body, status, fehler, created_at")
    .neq("status", "reserviert")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  const alle = ((data ?? []) as Nachricht[]).reverse();

  // Termine: über termin_id der Nachrichten und über die Nummer (jüngster Termin je Nummer)
  const nummern = [...new Set(alle.map((n) => n.telefon))];
  const termine: TerminInfo[] = [];
  for (let i = 0; i < nummern.length; i += 100) {
    const { data: t } = await svc
      .from("wa_termine")
      .select("id, telefon, name, firma, art, start_at, status, bestaetigt_am, verschieben_am, close_lead_id")
      .in("telefon", nummern.slice(i, i + 100))
      .order("start_at", { ascending: false });
    termine.push(...((t ?? []) as TerminInfo[]));
  }
  const terminNachId = new Map(termine.map((t) => [t.id, t]));

  const chatsMap = new Map<string, Nachricht[]>();
  for (const n of alle) {
    const liste = chatsMap.get(n.telefon) ?? [];
    liste.push(n);
    chatsMap.set(n.telefon, liste);
  }
  const chats: Chat[] = [...chatsMap.entries()]
    .map(([telefon, nachrichten]) => {
      const letzte = nachrichten[nachrichten.length - 1];
      const mitTermin = [...nachrichten].reverse().find((n) => n.termin_id && terminNachId.has(n.termin_id));
      const termin =
        (mitTermin ? terminNachId.get(mitTermin.termin_id!) : undefined) ?? termine.find((t) => t.telefon === telefon) ?? null;
      return { telefon, nachrichten, letzte, termin };
    })
    .sort((a, b) => b.letzte.created_at.localeCompare(a.letzte.created_at));

  const gewaehlt = typeof sp.nr === "string" ? chats.find((c) => c.telefon === sp.nr) ?? null : chats[0] ?? null;
  const titel = (c: Chat) => c.termin?.name ?? c.termin?.firma ?? c.telefon;

  return (
    <div className="space-y-6">
      <AutoAktualisieren sekunden={20} />
      <div className="flex flex-col gap-1">
        <h1 className="fern-page-title">WhatsApp-Chats</h1>
        <p className="text-[15px] text-muted-foreground">
          Alle Nachrichten des Terminbots, wie sie im WhatsApp-Verlauf der Leads stehen. Aktualisiert sich automatisch.
        </p>
      </div>

      {error && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">Nachrichten nicht ladbar: {error.message}</p>}

      {chats.length === 0 ? (
        <section className="fern-card p-6 text-sm text-muted-foreground">Noch keine Chats.</section>
      ) : (
        <section className="fern-card grid overflow-hidden p-0 md:h-[calc(100vh-14rem)] md:grid-cols-[320px_1fr]">
          <ul className={cn("overflow-y-auto border-b md:border-r md:border-b-0", gewaehlt && sp.nr && "hidden md:block")}>
            {chats.map((c) => {
              const aktiv = gewaehlt?.telefon === c.telefon;
              const unbeantwortet = c.letzte.richtung === "ein";
              return (
                <li key={c.telefon}>
                  <Link
                    href={`?nr=${encodeURIComponent(c.telefon)}`}
                    scroll={false}
                    className={cn("flex flex-col gap-0.5 border-b px-4 py-3 transition-colors hover:bg-muted/60", aktiv && "bg-muted")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{titel(c)}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{kurzZeit(c.letzte.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <StatusHaken n={c.letzte} />
                      <span className="truncate">{c.letzte.body ?? c.letzte.vorlage ?? `[${c.letzte.typ}]`}</span>
                      {unbeantwortet && <span className="ml-auto size-2 shrink-0 rounded-full bg-success" title="Antwort vom Lead" />}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {gewaehlt ? (
            <div className="flex min-h-[60vh] flex-col md:min-h-0">
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                {sp.nr && (
                  <Link href="?" className="text-sm text-muted-foreground md:hidden">
                    ← Chats
                  </Link>
                )}
                <div className="min-w-0">
                  <p className="truncate font-semibold">{titel(gewaehlt)}</p>
                  <p className="text-xs text-muted-foreground">
                    {gewaehlt.telefon}
                    {gewaehlt.termin?.firma && gewaehlt.termin.name && <> · {gewaehlt.termin.firma}</>}
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                  {gewaehlt.termin && (
                    <>
                      <span className="text-muted-foreground">
                        {gewaehlt.termin.art === "strategie" ? "Strategiegespräch" : "Erstgespräch"}{" "}
                        {formatDatum(new Date(gewaehlt.termin.start_at))}, {formatUhrzeit(new Date(gewaehlt.termin.start_at))}
                      </span>
                      <Badge className={terminStand(gewaehlt.termin).farbe}>{terminStand(gewaehlt.termin).text}</Badge>
                    </>
                  )}
                  {gewaehlt.termin?.close_lead_id && (
                    <a
                      href={`https://app.close.com/lead/${gewaehlt.termin.close_lead_id}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      In Close öffnen
                    </a>
                  )}
                </div>
              </div>

              <div className="flex flex-1 flex-col-reverse overflow-y-auto bg-muted/40 px-3 py-4 sm:px-6">
                <div className="space-y-2">
                  {gewaehlt.nachrichten.map((n, i) => {
                    const tag = formatDatum(new Date(n.created_at));
                    const neuerTag = i === 0 || formatDatum(new Date(gewaehlt.nachrichten[i - 1].created_at)) !== tag;
                    const aus = n.richtung === "aus";
                    const knoepfe = n.vorlage ? KNOEPFE.get(n.vorlage) ?? [] : [];
                    return (
                      <div key={n.id}>
                        {neuerTag && (
                          <p className="my-3 text-center">
                            <span className="rounded-full bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm">{tag}</span>
                          </p>
                        )}
                        <div className={cn("flex", aus ? "justify-end" : "justify-start")}>
                          <div
                            className={cn(
                              "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[70%]",
                              aus ? "rounded-br-md bg-[#d9fdd3] text-neutral-900 dark:bg-[#005c4b] dark:text-neutral-50" : "rounded-bl-md bg-background",
                              n.status === "fehlgeschlagen" && "ring-1 ring-destructive",
                            )}
                          >
                            {n.typ === "button" && !aus && <p className="mb-0.5 text-[11px] text-muted-foreground">Knopf gedrückt</p>}
                            <p className="whitespace-pre-line break-words">{n.body ?? `[${n.typ ?? "Nachricht"}]`}</p>
                            {knoepfe.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-black/10 pt-2 dark:border-white/15">
                                {knoepfe.map((k) => (
                                  <span key={k} className="text-xs font-medium text-sky-700 dark:text-sky-300">
                                    {k}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground dark:text-neutral-300">
                              {n.vorlage && <span className="mr-auto pr-3">{n.vorlage}</span>}
                              {formatUhrzeit(new Date(n.created_at))}
                              <StatusHaken n={n} />
                            </div>
                            {n.fehler && <p className="mt-1 text-xs text-destructive">Nicht zugestellt: {n.fehler}</p>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                Nur Ansicht. Antworten des Leads landen zusätzlich als Notiz in Close.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
              <MessagesSquare className="mr-2 size-4" /> Chat auswählen
            </div>
          )}
        </section>
      )}
    </div>
  );
}
