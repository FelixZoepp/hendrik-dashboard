"use client";

import { useState } from "react";
import { KanbanBoard } from "@/components/leads/kanban-board";
import { LeadList } from "@/components/leads/lead-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LayoutGrid, List, Search, Plus } from "lucide-react";
import type { Lead } from "@/lib/types/database";

type ViewMode = "kanban" | "liste";

interface LeadsViewProps {
  leads: Lead[];
  isStaff: boolean;
}

export function LeadsView({ leads, isStaff }: LeadsViewProps) {
  const [view, setView] = useState<ViewMode>("kanban");
  const [search, setSearch] = useState("");

  const filtered = search
    ? leads.filter((l) => {
        const term = search.toLowerCase();
        return (
          l.vorname.toLowerCase().includes(term) ||
          l.nachname.toLowerCase().includes(term) ||
          l.ort?.toLowerCase().includes(term) ||
          l.telefon?.includes(term) ||
          l.email?.toLowerCase().includes(term) ||
          l.anliegen?.toLowerCase().includes(term)
        );
      })
    : leads;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {leads.length} Lead{leads.length !== 1 && "s"} gesamt
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-56 sm:flex-initial">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <div className="flex items-center rounded-md border bg-muted p-0.5">
            <Button
              variant={view === "kanban" ? "default" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setView("kanban")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={view === "liste" ? "default" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setView("liste")}
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
          {isStaff && (
            <Button size="sm" className="h-8">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Lead anlegen
            </Button>
          )}
        </div>
      </div>

      {view === "kanban" ? (
        <KanbanBoard leads={filtered} />
      ) : (
        <LeadList leads={filtered} />
      )}
    </div>
  );
}
