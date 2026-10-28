"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRightLeft,
  CalendarClock,
  Check,
  ChevronDown,
  FileText,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  PhoneMissed,
  PhoneOff,
  PhoneForwarded,
  Send,
  Voicemail,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatCurrency, quelleLabel } from "@/lib/lead-utils";
import {
  STUFEN,
  alterText,
  rueckrufText,
  statusHinweis,
  stufeVon,
  stufenInfo,
  telLink,
  verlustGrundLabel,
  zeitpunktText,
} from "@/lib/crm/logik";
import { AlterAmpel } from "@/components/crm/alter-ampel";
import { AnrufenKnopf, WhatsAppKnopf } from "@/components/crm/kontakt-knoepfe";
import { RueckrufWahl } from "@/components/crm/rueckruf-wahl";
import { useStufenWechsel } from "@/components/crm/stufen-wechsel";
import { TermineBereich, type TerminZeile } from "@/components/auswertung/termin-karten";
import type { AnrufErgebnis } from "@/lib/auswertung/logik";
import { addLeadActivity, anrufErgebnis, nichtErreicht, rueckrufSetzen, zustaendigSetzen } from "../actions";
import type { Lead, LeadActivity, LeadActivityTyp } from "@/lib/types/database";

interface LeadDetailProps {
  lead: Lead;
  aktivitaeten: LeadActivity[];
  personen: { id: string; name: string }[];
  namen: Record<string, string>;
  firmenName: string;
  /** Nach „Anrufen“ von Karte/Start: gleich nach dem Ergebnis fragen */
  anrufFrage?: boolean;
  termine: TerminZeile[];
  jetztIso: string;
}

const NICHT_ERREICHT_KNOEPFE: { wert: AnrufErgebnis; label: string; icon: typeof Phone; erfolg: string }[] = [
  { wert: "nicht_erreicht", label: "Nicht erreicht", icon: PhoneMissed, erfolg: "Versuch gezählt" },
  { wert: "mailbox", label: "Mailbox", icon: Voicemail, erfolg: "Mailbox vermerkt" },
  { wert: "rueckruf_gewuenscht", label: "Rückruf gewünscht", icon: PhoneForwarded, erfolg: "Erreicht – Rückruf gewünscht" },
  { wert: "falsche_nummer", label: "Falsche Nummer", icon: PhoneOff, erfolg: "Falsche Nummer vermerkt" },
];

function Bereich({ titel, children, className }: { titel: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("fern-card space-y-3 p-5", className)}>
      <h2 className="text-base font-bold">{titel}</h2>
      {children}
    </section>
  );
}

export function LeadDetail({ lead, aktivitaeten, personen, namen, firmenName, anrufFrage, termine, jetztIso }: LeadDetailProps) {
  const router = useRouter();
  const stufe = stufenInfo(stufeVon(lead.status));
  const { starte, dialog, laeuft: stufeLaeuft } = useStufenWechsel();
  const [frage, setFrage] = useState<"ergebnis" | "rueckruf" | "rueckruf_gewuenscht" | null>(anrufFrage ? "ergebnis" : null);
  const [laeuft, setLaeuft] = useState(false);
  const [rueckrufModus, setRueckrufModus] = useState<"planen" | "nicht_erreicht" | null>(null);
  const [notiz, setNotiz] = useState("");

  async function ausfuehren(fn: () => Promise<{ error: string | null }>, erfolg: string) {
    setLaeuft(true);
    try {
      const res = await fn();
      if (res.error) {
        toast.error(res.error);
        return false;
      }
      toast.success(erfolg);
      router.refresh();
      return true;
    } catch {
      toast.error("Hat nicht geklappt. Bitte nochmal versuchen.");
      return false;
    } finally {
      setLaeuft(false);
    }
  }

  const versuche = lead.kontakt_versuche ?? 0;
  const antworten = Array.isArray(lead.antworten) ? lead.antworten.filter((a) => a && (a.frage || a.antwort)) : [];
  const utm = lead.utm && typeof lead.utm === "object" ? Object.entries(lead.utm).filter(([, v]) => v) : [];
  const herkunft = [
    { label: "Formular", wert: lead.formular },
    { label: "Kampagne", wert: lead.campaign },
    { label: "Anzeigengruppe", wert: lead.anzeigengruppe },
  ].filter((h) => h.wert);
  const tel = telLink(lead.telefon);
  const grund = verlustGrundLabel(lead.verlust_grund);
  const hinweis = statusHinweis(lead.status);

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Alle Anfragen
      </Link>

      {/* Kopf */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="fern-page-title">
            {lead.vorname} {lead.nachname}
          </h1>
          <span className={cn("rounded-md px-2 py-0.5 text-sm font-semibold", stufe.farbe)}>{stufe.label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {(lead.ort || lead.plz) && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {[lead.plz, lead.ort].filter(Boolean).join(" ")}
            </span>
          )}
          <AlterAmpel lead={lead} className="text-sm" />
          <span>{quelleLabel(lead.quelle)}</span>
        </div>
      </div>

      {/* Große Kontakt-Knöpfe */}
      {lead.telefon ? (
        <div className="flex gap-3">
          <AnrufenKnopf leadId={lead.id} telefon={lead.telefon} groesse="gross" nachher={() => setFrage("ergebnis")} />
          <WhatsAppKnopf leadId={lead.id} telefon={lead.telefon} firmenName={firmenName} vorname={lead.vorname} groesse="gross" />
        </div>
      ) : (
        <p className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">Keine Telefonnummer hinterlegt.</p>
      )}

      {/* Ergebnis des Anrufs */}
      {frage && (
        <div className="fern-card space-y-3 border-2 border-primary/30 p-5">
          {frage === "ergebnis" ? (
            <>
              <p className="text-lg font-bold">Wie lief der Anruf?</p>
              <Button
                size="lg"
                className="h-14 w-full rounded-2xl text-base"
                disabled={laeuft}
                onClick={async () => {
                  if (await ausfuehren(() => anrufErgebnis(lead.id, "erreicht"), "Super – als erreicht vermerkt")) setFrage(null);
                }}
              >
                <Check className="size-5" /> Erreicht
              </Button>
              <div className="grid grid-cols-2 gap-2">
                {NICHT_ERREICHT_KNOEPFE.map((k) => (
                  <Button
                    key={k.wert}
                    size="lg"
                    variant="outline"
                    className="h-12 rounded-2xl text-sm"
                    disabled={laeuft}
                    onClick={async () => {
                      // 1 Tipp speichert den Versuch – der Rückruf danach ist freiwillig
                      if (!(await ausfuehren(() => anrufErgebnis(lead.id, k.wert), k.erfolg))) return;
                      setFrage(k.wert === "falsche_nummer" ? null : k.wert === "rueckruf_gewuenscht" ? "rueckruf_gewuenscht" : "rueckruf");
                    }}
                  >
                    <k.icon className="size-4" /> {k.label}
                  </Button>
                ))}
              </div>
              <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setFrage(null)}>
                Später eintragen
              </button>
            </>
          ) : (
            <>
              <p className="text-lg font-bold">
                {frage === "rueckruf_gewuenscht" ? "Wann sollst du zurückrufen?" : "Wann nochmal anrufen?"}
              </p>
              <RueckrufWahl
                disabled={laeuft}
                onWahl={async (iso) => {
                  if (await ausfuehren(() => rueckrufSetzen(lead.id, iso), `Rückruf ${rueckrufText(iso)} geplant`)) setFrage(null);
                }}
              />
              <Button variant="ghost" disabled={laeuft} onClick={() => setFrage(null)}>
                Ohne Rückruf
              </Button>
            </>
          )}
        </div>
      )}

      {/* Stufe */}
      <Bereich titel="Wo steht die Anfrage?">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {STUFEN.map((s) => {
            const aktiv = s.id === stufe.id;
            return (
              <button
                key={s.id}
                type="button"
                disabled={stufeLaeuft}
                onClick={() => void starte(lead, s.id)}
                className={cn(
                  "min-h-14 rounded-2xl border-2 px-3 py-2 text-base font-semibold transition disabled:opacity-60",
                  aktiv ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/50",
                )}
                aria-pressed={aktiv}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {(lead.angebotswert != null || lead.auftragswert != null || grund || hinweis) && (
          <dl className="grid grid-cols-2 gap-3 pt-1 text-sm">
            {lead.angebotswert != null && (
              <div>
                <dt className="text-muted-foreground">Angebot</dt>
                <dd className="text-lg font-bold">{formatCurrency(lead.angebotswert)}</dd>
              </div>
            )}
            {lead.auftragswert != null && stufe.id === "auftrag" && (
              <div>
                <dt className="text-muted-foreground">Auftrag</dt>
                <dd className="text-lg font-bold text-success">{formatCurrency(lead.auftragswert)}</dd>
              </div>
            )}
            {stufe.id === "verloren" && (grund || hinweis) && (
              <div className="col-span-2">
                <dt className="text-muted-foreground">Grund</dt>
                <dd className="font-semibold">
                  {grund ?? hinweis}
                  {lead.verlust_notiz && <span className="font-normal"> – {lead.verlust_notiz}</span>}
                </dd>
              </div>
            )}
          </dl>
        )}
      </Bereich>

      {/* Termine (Show / No-Show / Neuvereinbarung) */}
      <Bereich titel="Termine">
        <TermineBereich leadId={lead.id} termine={termine} abgeschlossen={stufe.abschluss} jetztIso={jetztIso} />
      </Bereich>

      {/* Rückruf + Nicht erreicht */}
      {!stufe.abschluss && (
        <Bereich titel="Rückruf">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-base" suppressHydrationWarning>
              <CalendarClock className="size-5 text-primary" />
              {lead.naechste_aktion_am ? (
                <span className="font-semibold">{rueckrufText(lead.naechste_aktion_am)}</span>
              ) : (
                <span className="text-muted-foreground">Kein Rückruf geplant</span>
              )}
            </p>
            {lead.naechste_aktion_am && (
              <Button
                variant="outline"
                disabled={laeuft}
                onClick={() => void ausfuehren(() => rueckrufSetzen(lead.id, null), "Rückruf gelöscht")}
              >
                <X /> Löschen
              </Button>
            )}
          </div>
          {rueckrufModus ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold">
                {rueckrufModus === "planen" ? "Wann anrufen?" : "Nicht erreicht – wann nochmal anrufen?"}
              </p>
              <RueckrufWahl
                disabled={laeuft}
                onWahl={async (iso) => {
                  const ok = await ausfuehren(
                    () => (rueckrufModus === "planen" ? rueckrufSetzen(lead.id, iso) : nichtErreicht(lead.id, iso)),
                    `Rückruf ${rueckrufText(iso)} geplant`,
                  );
                  if (ok) setRueckrufModus(null);
                }}
              />
              <div className="flex flex-wrap gap-2">
                {rueckrufModus === "nicht_erreicht" && (
                  <Button
                    variant="outline"
                    disabled={laeuft}
                    onClick={async () => {
                      if (await ausfuehren(() => nichtErreicht(lead.id), "Versuch gezählt")) setRueckrufModus(null);
                    }}
                  >
                    Ohne Rückruf speichern
                  </Button>
                )}
                <Button variant="ghost" disabled={laeuft} onClick={() => setRueckrufModus(null)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" className="h-12 rounded-2xl" onClick={() => setRueckrufModus("planen")}>
                <CalendarClock /> Rückruf planen
              </Button>
              <Button variant="outline" size="lg" className="h-12 rounded-2xl" onClick={() => setRueckrufModus("nicht_erreicht")}>
                <PhoneMissed /> Nicht erreicht
              </Button>
            </div>
          )}
          {versuche > 0 && (
            <p className="text-sm text-muted-foreground">
              Bisher {versuche}× nicht erreicht
            </p>
          )}
        </Bereich>
      )}

      {/* Kontakt */}
      <Bereich titel="Kontakt">
        <dl className="space-y-2 text-base">
          {lead.telefon && (
            <div className="flex items-center gap-2">
              <Phone className="size-4 text-muted-foreground" />
              {tel ? <a href={tel} className="font-semibold text-primary underline-offset-4 hover:underline">{lead.telefon}</a> : lead.telefon}
            </div>
          )}
          {lead.email && (
            <div className="flex items-center gap-2 break-all">
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <a href={`mailto:${lead.email}`} className="text-primary underline-offset-4 hover:underline">{lead.email}</a>
            </div>
          )}
          {(lead.plz || lead.ort) && (
            <div className="flex items-center gap-2">
              <MapPin className="size-4 text-muted-foreground" />
              {[lead.plz, lead.ort].filter(Boolean).join(" ")}
            </div>
          )}
          <div className="text-sm text-muted-foreground" suppressHydrationWarning>
            Eingegangen {zeitpunktText(lead.created_at)} · {quelleLabel(lead.quelle)}
            {lead.first_contact_at && <> · Erster Kontakt {alterText(lead.first_contact_at)}</>}
          </div>
        </dl>
        {personen.length > 1 && (
          <label className="flex flex-wrap items-center gap-2 pt-1 text-sm">
            <User className="size-4 text-muted-foreground" />
            <span className="font-semibold">Zuständig:</span>
            <select
              className="h-11 min-w-48 rounded-full border border-input bg-card px-4 text-base"
              value={lead.assigned_to && personen.some((p) => p.id === lead.assigned_to) ? lead.assigned_to : ""}
              disabled={laeuft}
              onChange={(e) => void ausfuehren(() => zustaendigSetzen(lead.id, e.target.value || null), "Zuständigkeit gespeichert")}
            >
              <option value="">Niemand</option>
              {personen.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </Bereich>

      {/* Anfrage */}
      <Bereich titel="Anfrage">
        {lead.anliegen ? <p className="whitespace-pre-wrap text-base">{lead.anliegen}</p> : antworten.length === 0 && <p className="text-muted-foreground">Kein Text zur Anfrage.</p>}
        {antworten.length > 0 && (
          <dl className="divide-y rounded-2xl border">
            {antworten.map((a, i) => (
              <div key={i} className="space-y-0.5 px-4 py-3">
                <dt className="text-sm text-muted-foreground">{a.frage}</dt>
                <dd className="text-base font-semibold whitespace-pre-wrap">{a.antwort || "—"}</dd>
              </div>
            ))}
          </dl>
        )}
        {(herkunft.length > 0 || utm.length > 0) && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {herkunft.map((h) => (
              <div key={h.label} className="flex gap-2">
                <dt className="text-muted-foreground">{h.label}:</dt>
                <dd className="font-medium break-all">{h.wert}</dd>
              </div>
            ))}
            {utm.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="text-muted-foreground">{k}:</dt>
                <dd className="font-medium break-all">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {lead.form_payload && Object.keys(lead.form_payload).length > 0 && (
          <details className="group rounded-2xl bg-muted/60 px-4 py-3 text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-1 font-semibold text-muted-foreground">
              <ChevronDown className="size-4 transition group-open:rotate-180" />
              Technische Daten
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(lead.form_payload, null, 2)}
            </pre>
          </details>
        )}
      </Bereich>

      {/* Notiz */}
      <Bereich titel="Notiz schreiben">
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!notiz.trim()) return;
            if (await ausfuehren(() => addLeadActivity(lead.id, { typ: "notiz", inhalt: notiz }), "Notiz gespeichert")) setNotiz("");
          }}
        >
          <Textarea
            placeholder="z. B. Möchte Angebot bis Freitag, Hund im Garten"
            value={notiz}
            onChange={(e) => setNotiz(e.target.value)}
            rows={3}
            className="rounded-2xl text-base"
          />
          <Button type="submit" size="lg" disabled={laeuft || !notiz.trim()}>
            <Send /> Speichern
          </Button>
        </form>
      </Bereich>

      {/* Verlauf */}
      <Bereich titel="Verlauf">
        <Verlauf aktivitaeten={aktivitaeten} namen={namen} />
      </Bereich>

      {dialog}
    </div>
  );
}

const ICONS: Record<LeadActivityTyp, typeof Phone> = {
  anruf: Phone,
  notiz: FileText,
  status_wechsel: ArrowRightLeft,
  email: Mail,
  whatsapp: MessageCircle,
  nicht_erreicht: PhoneMissed,
  rueckruf: CalendarClock,
};

function Verlauf({ aktivitaeten, namen }: { aktivitaeten: LeadActivity[]; namen: Record<string, string> }) {
  if (aktivitaeten.length === 0) return <p className="text-sm text-muted-foreground">Noch nichts passiert.</p>;
  return (
    <ol className="space-y-0">
      {aktivitaeten.map((a, i) => {
        const Icon = ICONS[a.typ] ?? FileText;
        const wechsel = a.typ === "status_wechsel" && a.alt_status && a.neu_status;
        // Alte Einträge tragen nur „Status geändert …“ – den Text zeigen wir nicht doppelt
        const zusatz = a.inhalt && !/^Status( geändert)?:/.test(a.inhalt) ? a.inhalt : null;
        return (
          <li key={a.id} className={cn("flex gap-3 py-3", i < aktivitaeten.length - 1 && "border-b border-border/60")}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              {wechsel ? (
                <p className="text-sm font-semibold">
                  {stufenInfo(stufeVon(a.alt_status!)).label} → {stufenInfo(stufeVon(a.neu_status!)).label}
                </p>
              ) : null}
              {(zusatz || !wechsel) && <p className="text-sm whitespace-pre-wrap">{zusatz ?? a.inhalt ?? ""}</p>}
              <p className="text-xs text-muted-foreground">
                {zeitpunktText(a.created_at)}
                {a.user_id && namen[a.user_id] ? ` · ${namen[a.user_id]}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
