"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LeadCard } from "./lead-card";
import { KANBAN_COLUMNS, LEAD_STATUS_CONFIG } from "@/lib/lead-utils";
import { updateLeadStatus } from "@/app/(client)/leads/actions";
import { toast } from "sonner";
import type { Lead, LeadStatus } from "@/lib/types/database";

interface KanbanBoardProps {
  leads: Lead[];
}

function DroppableColumn({
  status,
  children,
}: {
  status: string;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  const config = LEAD_STATUS_CONFIG[status as LeadStatus];

  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-lg lg:w-72 transition-colors ${
        isOver ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/50"
      }`}
    >
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <span className="text-xs font-medium text-foreground">
          {config.label}
        </span>
      </div>
      <ScrollArea className="flex-1 p-2">
        <div className="space-y-2 min-h-16">{children}</div>
      </ScrollArea>
    </div>
  );
}

function DraggableLeadCard({
  lead,
  href,
}: {
  lead: Lead;
  href: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: lead.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <LeadCard lead={lead} href={href} />
    </div>
  );
}

export function KanbanBoard({ leads: initialLeads }: KanbanBoardProps) {
  const [leads, setLeads] = useState(initialLeads);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const activeLead = activeId
    ? leads.find((l) => l.id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const leadId = active.id as string;
    const newStatus = over.id as LeadStatus;

    // Nur wenn über eine Spalte gedroppt wird
    if (!KANBAN_COLUMNS.includes(newStatus)) return;

    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === newStatus) return;

    // Optimistisches Update
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l))
    );
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const leadId = active.id as string;
    const newStatus = over.id as LeadStatus;

    if (!KANBAN_COLUMNS.includes(newStatus)) return;

    const originalLead = initialLeads.find((l) => l.id === leadId);
    if (!originalLead || originalLead.status === newStatus) return;

    // Gewonnen/Verloren braucht Pflichtfelder — redirect zur Detail-Seite
    if (newStatus === "gewonnen" || newStatus === "verloren") {
      setLeads(initialLeads); // Revert
      toast.info(
        `Öffne den Lead, um ihn als "${LEAD_STATUS_CONFIG[newStatus].label}" zu markieren.`
      );
      return;
    }

    // Server-seitig updaten
    const result = await updateLeadStatus(leadId, { status: newStatus });
    if (result?.error) {
      setLeads(initialLeads); // Revert bei Fehler
      toast.error("Status konnte nicht geändert werden");
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {KANBAN_COLUMNS.map((status) => {
          const columnLeads = leads.filter((l) => l.status === status);

          return (
            <DroppableColumn key={status} status={status}>
              {columnLeads.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                  Keine Leads
                </p>
              ) : (
                columnLeads.map((lead) => (
                  <DraggableLeadCard
                    key={lead.id}
                    lead={lead}
                    href={`/leads/${lead.id}`}
                  />
                ))
              )}
            </DroppableColumn>
          );
        })}
      </div>

      <DragOverlay>
        {activeLead && (
          <div className="w-64 lg:w-72 opacity-90 rotate-2 shadow-lg">
            <LeadCard lead={activeLead} href="#" />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
