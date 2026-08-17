"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { LeadCard } from "./lead-card";
import { KANBAN_COLUMNS, LEAD_STATUS_CONFIG } from "@/lib/lead-utils";
import type { Lead } from "@/lib/types/database";

interface KanbanBoardProps {
  leads: Lead[];
}

export function KanbanBoard({ leads }: KanbanBoardProps) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {KANBAN_COLUMNS.map((status) => {
        const config = LEAD_STATUS_CONFIG[status];
        const columnLeads = leads.filter((l) => l.status === status);

        return (
          <div
            key={status}
            className="flex w-64 shrink-0 flex-col rounded-lg bg-muted/50 lg:w-72"
          >
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
              <span className="text-xs font-medium text-foreground">
                {config.label}
              </span>
              <span className="text-xs font-mono text-muted-foreground tabular-nums">
                {columnLeads.length}
              </span>
            </div>
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-2">
                {columnLeads.length === 0 ? (
                  <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                    Keine Leads
                  </p>
                ) : (
                  columnLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      href={`/leads/${lead.id}`}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        );
      })}
    </div>
  );
}
