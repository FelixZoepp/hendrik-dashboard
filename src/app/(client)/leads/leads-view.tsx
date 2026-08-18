"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KanbanBoard } from "@/components/leads/kanban-board";
import { LeadList } from "@/components/leads/lead-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEAD_STATUS_CONFIG, LEAD_QUELLEN } from "@/lib/lead-utils";
import { createLead } from "./actions";
import { LayoutGrid, List, Search, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Lead, LeadStatus, LeadQuelle, Company } from "@/lib/types/database";

type ViewMode = "kanban" | "liste";

interface LeadsViewProps {
  leads: Lead[];
  isStaff: boolean;
  companies?: Pick<Company, "id" | "name">[];
  userCompanyId?: string | null;
}

export function LeadsView({ leads, isStaff, companies, userCompanyId }: LeadsViewProps) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("kanban");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "alle">("alle");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    vorname: "",
    nachname: "",
    telefon: "",
    email: "",
    plz: "",
    ort: "",
    anliegen: "",
    quelle: "" as LeadQuelle | "",
    company_id: "",
  });

  const filtered = leads.filter((l) => {
    // Status filter
    if (statusFilter !== "alle" && l.status !== statusFilter) {
      return false;
    }
    // Text search
    if (search) {
      const term = search.toLowerCase();
      return (
        l.vorname.toLowerCase().includes(term) ||
        l.nachname.toLowerCase().includes(term) ||
        l.ort?.toLowerCase().includes(term) ||
        l.telefon?.includes(term) ||
        l.email?.toLowerCase().includes(term) ||
        l.anliegen?.toLowerCase().includes(term)
      );
    }
    return true;
  });

  function resetForm() {
    setFormData({
      vorname: "",
      nachname: "",
      telefon: "",
      email: "",
      plz: "",
      ort: "",
      anliegen: "",
      quelle: "",
      company_id: "",
    });
  }

  async function handleCreateLead() {
    if (!formData.vorname.trim() || !formData.nachname.trim()) {
      toast.error("Vorname und Nachname sind Pflichtfelder");
      return;
    }

    const companyId = isStaff ? formData.company_id : userCompanyId;
    if (!companyId) {
      toast.error("Bitte wähle ein Unternehmen aus");
      return;
    }

    setCreating(true);
    try {
      const result = await createLead({
        company_id: companyId,
        vorname: formData.vorname.trim(),
        nachname: formData.nachname.trim(),
        telefon: formData.telefon.trim() || undefined,
        email: formData.email.trim() || undefined,
        plz: formData.plz.trim() || undefined,
        ort: formData.ort.trim() || undefined,
        anliegen: formData.anliegen.trim() || undefined,
        quelle: (formData.quelle || undefined) as LeadQuelle | undefined,
      });

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Lead erfolgreich angelegt");
        setShowCreateDialog(false);
        resetForm();
        router.refresh();
      }
    } catch {
      toast.error("Lead konnte nicht angelegt werden");
    }
    setCreating(false);
  }

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
          {/* Status-Filter */}
          <Select
            value={statusFilter}
            onValueChange={(v) => v && setStatusFilter(v as LeadStatus | "alle")}
          >
            <SelectTrigger className="h-8 w-40 text-sm" size="sm">
              <SelectValue placeholder="Alle Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Status</SelectItem>
              {Object.entries(LEAD_STATUS_CONFIG).map(([value, config]) => (
                <SelectItem key={value} value={value}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          {(isStaff || userCompanyId) && (
            <Button
              size="sm"
              className="h-8"
              onClick={() => setShowCreateDialog(true)}
            >
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

      {/* Lead anlegen Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Neuen Lead anlegen</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-vorname">Vorname *</Label>
                <Input
                  id="create-vorname"
                  placeholder="Vorname"
                  value={formData.vorname}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, vorname: e.target.value }))
                  }
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-nachname">Nachname *</Label>
                <Input
                  id="create-nachname"
                  placeholder="Nachname"
                  value={formData.nachname}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, nachname: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-telefon">Telefon</Label>
                <Input
                  id="create-telefon"
                  placeholder="+49…"
                  value={formData.telefon}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, telefon: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-email">E-Mail</Label>
                <Input
                  id="create-email"
                  type="email"
                  placeholder="email@beispiel.de"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, email: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-plz">PLZ</Label>
                <Input
                  id="create-plz"
                  placeholder="12345"
                  value={formData.plz}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, plz: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-ort">Ort</Label>
                <Input
                  id="create-ort"
                  placeholder="Stadt"
                  value={formData.ort}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, ort: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-anliegen">Anliegen</Label>
              <Textarea
                id="create-anliegen"
                placeholder="Kurze Beschreibung des Anliegens…"
                value={formData.anliegen}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, anliegen: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Quelle</Label>
              <Select
                value={formData.quelle}
                onValueChange={(v) =>
                  v && setFormData((p) => ({ ...p, quelle: v as LeadQuelle }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Quelle wählen…" />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_QUELLEN.map((q) => (
                    <SelectItem key={q.value} value={q.value}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isStaff && companies && (
              <div className="space-y-1.5">
                <Label>Unternehmen *</Label>
                <Select
                  value={formData.company_id}
                  onValueChange={(v) =>
                    v && setFormData((p) => ({ ...p, company_id: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unternehmen wählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateDialog(false);
                resetForm();
              }}
            >
              Abbrechen
            </Button>
            <Button onClick={handleCreateLead} disabled={creating}>
              {creating ? "Wird angelegt…" : "Lead anlegen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
