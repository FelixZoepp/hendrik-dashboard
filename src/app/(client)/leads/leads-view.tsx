"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { KanbanBoard } from "@/components/leads/kanban-board";
import { KeineLeads, LeadList } from "@/components/leads/lead-list";
import { LeadCard } from "@/components/leads/lead-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { quelleLabel } from "@/lib/lead-utils";
import { STUFEN, berlinTagesbeginn, stufeVon, stufenInfo, type Stufe } from "@/lib/crm/logik";
import { createLead } from "./actions";
import type { Lead, LeadQuelle } from "@/lib/types/database";

export type StufenFilter = "alle" | "offen" | Stufe;
type ZeitFilter = "alle" | "heute" | "7" | "30" | "90";
type Ansicht = "board" | "liste";

const ZEIT_FILTER: { value: ZeitFilter; label: string }[] = [
  { value: "alle", label: "Jederzeit" },
  { value: "heute", label: "Heute" },
  { value: "7", label: "Letzte 7 Tage" },
  { value: "30", label: "Letzte 30 Tage" },
  { value: "90", label: "Letzte 90 Tage" },
];

const TABS: { value: StufenFilter; label: string }[] = [
  { value: "offen", label: "Offen" },
  ...STUFEN.map((s) => ({ value: s.id as StufenFilter, label: s.kurz })),
  { value: "alle", label: "Alle" },
];

function passtStufe(lead: Lead, f: StufenFilter) {
  const s = stufeVon(lead.status);
  if (f === "alle") return true;
  if (f === "offen") return !stufenInfo(s).abschluss;
  return s === f;
}

const AUSWAHL =
  "h-11 rounded-full border border-input bg-card px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function LeadsView({
  leads,
  namen,
  startStufe,
}: {
  leads: Lead[];
  namen: Record<string, string>;
  startStufe: StufenFilter;
}) {
  const [ansicht, setAnsicht] = useState<Ansicht>("board");
  const [suche, setSuche] = useState("");
  const [stufe, setStufe] = useState<StufenFilter>(startStufe);
  const [quelle, setQuelle] = useState<string>("alle");
  const [zeit, setZeit] = useState<ZeitFilter>("alle");
  const [neuOffen, setNeuOffen] = useState(false);

  const quellen = useMemo(() => Array.from(new Set(leads.map((l) => l.quelle))).sort(), [leads]);

  // Suche, Quelle, Zeitraum (Stufe getrennt, damit Board und Tabs ihre Zahlen zeigen)
  const grundmenge = useMemo(() => {
    const term = suche.trim().toLowerCase();
    const ab =
      zeit === "alle" ? null : zeit === "heute" ? berlinTagesbeginn(new Date()) : berlinTagesbeginn(new Date(), -(Number(zeit) - 1));
    return leads.filter((l) => {
      if (quelle !== "alle" && l.quelle !== quelle) return false;
      if (ab && new Date(l.created_at) < ab) return false;
      if (!term) return true;
      return [l.vorname, l.nachname, `${l.vorname} ${l.nachname}`, l.ort, l.plz, l.telefon, l.email, l.anliegen]
        .some((f) => f?.toLowerCase().includes(term));
    });
  }, [leads, suche, quelle, zeit]);

  const gefiltert = grundmenge.filter((l) => passtStufe(l, stufe));
  const zaehler = (f: StufenFilter) => grundmenge.filter((l) => passtStufe(l, f)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="fern-page-title">Anfragen</h1>
          <p className="text-sm text-muted-foreground">
            {leads.length} {leads.length === 1 ? "Anfrage" : "Anfragen"} insgesamt
          </p>
        </div>
        <Button size="lg" className="h-12 px-5 text-base" onClick={() => setNeuOffen(true)}>
          <Plus className="size-5" />
          <span className="hidden sm:inline">Neue Anfrage</span>
          <span className="sm:hidden">Neu</span>
        </Button>
      </div>

      {/* Suche + Filter */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Name, Ort, Telefon suchen…"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            className="h-11 rounded-full pl-10 text-base"
          />
        </div>
        <div className="flex gap-2">
          {ansicht === "liste" && (
            <select
              aria-label="Stufe"
              className={cn(AUSWAHL, "hidden md:block")}
              value={stufe}
              onChange={(e) => setStufe(e.target.value as StufenFilter)}
            >
              {TABS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.value === "offen" || t.value === "alle" ? t.label : stufenInfo(t.value).label}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Quelle" className={cn(AUSWAHL, "flex-1 md:flex-none")} value={quelle} onChange={(e) => setQuelle(e.target.value)}>
            <option value="alle">Alle Quellen</option>
            {quellen.map((q) => (
              <option key={q} value={q}>
                {quelleLabel(q)}
              </option>
            ))}
          </select>
          <select aria-label="Zeitraum" className={cn(AUSWAHL, "flex-1 md:flex-none")} value={zeit} onChange={(e) => setZeit(e.target.value as ZeitFilter)}>
            {ZEIT_FILTER.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </select>
          <div className="hidden items-center rounded-full border bg-muted p-1 md:flex">
            <Button
              variant={ansicht === "board" ? "default" : "ghost"}
              size="sm"
              className="h-9"
              onClick={() => setAnsicht("board")}
              aria-pressed={ansicht === "board"}
            >
              <LayoutGrid /> Board
            </Button>
            <Button
              variant={ansicht === "liste" ? "default" : "ghost"}
              size="sm"
              className="h-9"
              onClick={() => setAnsicht("liste")}
              aria-pressed={ansicht === "liste"}
            >
              <List /> Liste
            </Button>
          </div>
        </div>
      </div>

      {/* Handy: Stufen-Tabs + Karten */}
      <div className="space-y-3 md:hidden">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setStufe(t.value)}
              className={cn(
                "flex h-10 shrink-0 items-center gap-1.5 rounded-full border-2 px-4 text-sm font-semibold",
                stufe === t.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
              )}
            >
              {t.label}
              <span className={cn("text-xs", stufe === t.value ? "opacity-80" : "text-muted-foreground")}>{zaehler(t.value)}</span>
            </button>
          ))}
        </div>
        {gefiltert.length === 0 ? (
          <KeineLeads text="In dieser Stufe ist gerade nichts." />
        ) : (
          gefiltert.map((l) => (
            <LeadCard key={l.id} lead={l} href={`/leads/${l.id}`} mitStufe zustaendig={l.assigned_to ? namen[l.assigned_to] : null} />
          ))
        )}
      </div>

      {/* Desktop: Board oder Liste */}
      <div className="hidden md:block">
        {ansicht === "board" ? (
          <KanbanBoard leads={grundmenge} namen={namen} />
        ) : (
          <LeadList leads={gefiltert} namen={namen} />
        )}
      </div>

      <NeuerLeadDialog offen={neuOffen} onOffen={setNeuOffen} />
    </div>
  );
}

function NeuerLeadDialog({ offen, onOffen }: { offen: boolean; onOffen: (o: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [telefon, setTelefon] = useState("");
  const [anliegen, setAnliegen] = useState("");
  const [quelle, setQuelle] = useState<LeadQuelle>("manuell");
  const [laeuft, setLaeuft] = useState(false);

  function leeren() {
    setName("");
    setTelefon("");
    setAnliegen("");
    setQuelle("manuell");
  }

  async function speichern() {
    if (!name.trim()) return toast.error("Bitte den Namen eintragen");
    if (!telefon.trim()) return toast.error("Bitte die Telefonnummer eintragen");
    setLaeuft(true);
    try {
      const res = await createLead({ name, telefon, anliegen: anliegen || undefined, quelle });
      if (res.error || !res.data) {
        toast.error(res.error ?? "Hat nicht geklappt");
        return;
      }
      toast.success("Anfrage angelegt");
      onOffen(false);
      leeren();
      router.push(`/leads/${res.data.id}`);
    } catch {
      toast.error("Hat nicht geklappt. Bitte nochmal versuchen.");
    } finally {
      setLaeuft(false);
    }
  }

  const feld = "h-14 rounded-2xl text-lg";
  return (
    <Dialog open={offen} onOpenChange={onOffen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Neue Anfrage</DialogTitle>
          <DialogDescription>Jemand hat angerufen oder wurde empfohlen? Kurz eintragen.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            void speichern();
          }}
        >
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Name</span>
            <Input autoFocus autoComplete="off" placeholder="Max Mustermann" value={name} onChange={(e) => setName(e.target.value)} className={feld} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Telefon</span>
            <Input type="tel" inputMode="tel" placeholder="0151 2345678" value={telefon} onChange={(e) => setTelefon(e.target.value)} className={feld} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Worum geht es?</span>
            <Textarea placeholder="z. B. Bad sanieren, ca. 8 m²" value={anliegen} onChange={(e) => setAnliegen(e.target.value)} rows={2} className="rounded-2xl text-base" />
          </label>
          <div className="space-y-1">
            <span className="text-sm font-semibold">Woher?</span>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "manuell", label: "Direkt (Anruf, vor Ort)" },
                { value: "empfehlung", label: "Empfehlung" },
              ] as const).map((q) => (
                <button
                  key={q.value}
                  type="button"
                  onClick={() => setQuelle(q.value)}
                  className={cn(
                    "min-h-12 rounded-2xl border-2 px-3 py-2 text-sm font-semibold",
                    quelle === q.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
                  )}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="lg" onClick={() => onOffen(false)} disabled={laeuft}>
            Abbrechen
          </Button>
          <Button size="lg" onClick={() => void speichern()} disabled={laeuft}>
            {laeuft ? "Speichert…" : "Anfrage speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
