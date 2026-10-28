"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { LeadCard } from "./lead-card";
import { STUFEN, istStufe, statusFuerStufe, stufeVon, type Stufe } from "@/lib/crm/logik";
import { formatCurrency } from "@/lib/lead-utils";
import { useStufenWechsel } from "@/components/crm/stufen-wechsel";
import type { Lead } from "@/lib/types/database";

interface KanbanBoardProps {
  leads: Lead[];
  namen?: Record<string, string>;
}

function Spalte({ stufe, anzahl, summe, children }: { stufe: (typeof STUFEN)[number]; anzahl: number; summe: number; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: stufe.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-2xl transition-colors",
        isOver ? "bg-primary/10 ring-2 ring-primary/40" : "bg-muted/60",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="text-sm font-semibold">{stufe.label}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {summe > 0 && <span className="font-semibold text-foreground">{formatCurrency(summe)}</span>}
          <span className="rounded-full bg-card px-2 py-0.5 font-semibold">{anzahl}</span>
        </span>
      </div>
      <div className="flex-1 space-y-2 px-2 pb-2 min-h-24">{children}</div>
    </div>
  );
}

function ZiehKarte({ lead, zustaendig }: { lead: Lead; zustaendig?: string | null }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.3 : 1 }}
      {...listeners}
      {...attributes}
      className="touch-manipulation"
    >
      <LeadCard lead={lead} href={`/leads/${lead.id}`} zustaendig={zustaendig} />
    </div>
  );
}

/** Pipeline-Board (Desktop): Karten per Drag & Drop in eine andere Stufe ziehen. */
export function KanbanBoard({ leads: serverLeads, namen }: KanbanBoardProps) {
  // Optimistische Verschiebungen bis die Seite neu geladen ist
  const [verschoben, setVerschoben] = useState<Record<string, Stufe>>({});
  const [aktivId, setAktivId] = useState<string | null>(null);
  const { starte, dialog } = useStufenWechsel();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const leads = serverLeads.map((l) =>
    verschoben[l.id] && stufeVon(l.status) !== verschoben[l.id] ? { ...l, status: statusFuerStufe(verschoben[l.id]) } : l,
  );
  const aktiv = aktivId ? leads.find((l) => l.id === aktivId) ?? null : null;

  function onDragStart(e: DragStartEvent) {
    setAktivId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setAktivId(null);
    const ziel = e.over?.id;
    if (!istStufe(ziel)) return;
    const lead = serverLeads.find((l) => l.id === e.active.id);
    if (!lead || stufeVon(lead.status) === ziel) return;

    setVerschoben((v) => ({ ...v, [lead.id]: ziel }));
    void starte(lead, ziel, (ok) => {
      // Erfolg: bleibt verschoben, bis die Server-Daten (refresh) da sind; Abbruch/Fehler: zurück
      if (ok) return;
      setVerschoben((v) => {
        const rest = { ...v };
        delete rest[lead.id];
        return rest;
      });
    });
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
        {STUFEN.map((stufe) => {
          const spalte = leads.filter((l) => stufeVon(l.status) === stufe.id);
          const summe =
            stufe.id === "auftrag"
              ? spalte.reduce((s, l) => s + Number(l.auftragswert ?? 0), 0)
              : stufe.id === "angebot"
                ? spalte.reduce((s, l) => s + Number(l.angebotswert ?? 0), 0)
                : 0;
          return (
            <Spalte key={stufe.id} stufe={stufe} anzahl={spalte.length} summe={summe}>
              {spalte.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-muted-foreground">Hierher ziehen</p>
              ) : (
                spalte.map((lead) => (
                  <ZiehKarte key={lead.id} lead={lead} zustaendig={lead.assigned_to ? namen?.[lead.assigned_to] : null} />
                ))
              )}
            </Spalte>
          );
        })}
      </div>

      <DragOverlay>
        {aktiv && (
          <div className="w-72 rotate-2 opacity-95 shadow-xl">
            <LeadCard lead={aktiv} href="#" ohneKnopf />
          </div>
        )}
      </DragOverlay>
      {dialog}
    </DndContext>
  );
}
