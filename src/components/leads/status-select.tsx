"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LEAD_STATUS_CONFIG, VERLUST_GRUENDE } from "@/lib/lead-utils";
import { toast } from "sonner";
import type { LeadStatus, VerlustGrund } from "@/lib/types/database";

interface StatusSelectProps {
  currentStatus: LeadStatus;
  onStatusChange: (data: {
    status: LeadStatus;
    auftragswert?: number;
    verlust_grund?: VerlustGrund;
  }) => Promise<void>;
}

export function StatusSelect({
  currentStatus,
  onStatusChange,
}: StatusSelectProps) {
  const [showGewonnenDialog, setShowGewonnenDialog] = useState(false);
  const [showVerlorenDialog, setShowVerlorenDialog] = useState(false);
  const [auftragswert, setAuftragswert] = useState("");
  const [verlustGrund, setVerlustGrund] = useState<VerlustGrund | "">("");
  const [loading, setLoading] = useState(false);

  async function handleChange(value: string) {
    const status = value as LeadStatus;

    if (status === "gewonnen") {
      setShowGewonnenDialog(true);
      return;
    }
    if (status === "verloren") {
      setShowVerlorenDialog(true);
      return;
    }

    setLoading(true);
    try {
      await onStatusChange({ status });
      toast.success(`Status auf „${LEAD_STATUS_CONFIG[status].label}" gesetzt`);
    } catch {
      toast.error("Status konnte nicht geändert werden");
    }
    setLoading(false);
  }

  async function handleGewonnen() {
    const wert = parseFloat(auftragswert);
    if (isNaN(wert) || wert <= 0) {
      toast.error("Bitte gib einen gültigen Auftragswert ein");
      return;
    }

    setLoading(true);
    try {
      await onStatusChange({ status: "gewonnen", auftragswert: wert });
      toast.success("Lead als gewonnen markiert");
      setShowGewonnenDialog(false);
      setAuftragswert("");
    } catch {
      toast.error("Fehler beim Speichern");
    }
    setLoading(false);
  }

  async function handleVerloren() {
    if (!verlustGrund) {
      toast.error("Bitte wähle einen Verlustgrund");
      return;
    }

    setLoading(true);
    try {
      await onStatusChange({
        status: "verloren",
        verlust_grund: verlustGrund,
      });
      toast.success("Lead als verloren markiert");
      setShowVerlorenDialog(false);
      setVerlustGrund("");
    } catch {
      toast.error("Fehler beim Speichern");
    }
    setLoading(false);
  }

  return (
    <>
      <Select
        value={currentStatus}
        onValueChange={(v) => v && handleChange(v)}
        disabled={loading}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(LEAD_STATUS_CONFIG).map(([value, config]) => (
            <SelectItem key={value} value={value}>
              {config.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Gewonnen-Dialog: Auftragswert Pflicht */}
      <Dialog open={showGewonnenDialog} onOpenChange={setShowGewonnenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lead als gewonnen markieren</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="auftragswert">Auftragswert (EUR)</Label>
            <Input
              id="auftragswert"
              type="number"
              min="0"
              step="100"
              placeholder="z.B. 3500"
              value={auftragswert}
              onChange={(e) => setAuftragswert(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowGewonnenDialog(false)}
            >
              Abbrechen
            </Button>
            <Button onClick={handleGewonnen} disabled={loading}>
              {loading ? "Wird gespeichert…" : "Als gewonnen markieren"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verloren-Dialog: Verlustgrund Pflicht */}
      <Dialog open={showVerlorenDialog} onOpenChange={setShowVerlorenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lead als verloren markieren</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Verlustgrund</Label>
            <Select
              value={verlustGrund}
              onValueChange={(v) => v && setVerlustGrund(v as VerlustGrund)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Grund auswählen…" />
              </SelectTrigger>
              <SelectContent>
                {VERLUST_GRUENDE.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowVerlorenDialog(false)}
            >
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={handleVerloren}
              disabled={loading}
            >
              {loading ? "Wird gespeichert…" : "Als verloren markieren"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
