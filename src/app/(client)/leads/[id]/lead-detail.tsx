"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SlaBadge } from "@/components/leads/sla-badge";
import { StatusSelect } from "@/components/leads/status-select";
import { ActivityFeed } from "@/components/leads/activity-feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { LEAD_STATUS_CONFIG, LEAD_QUELLEN, formatCurrency } from "@/lib/lead-utils";
import {
  Phone,
  Mail,
  MapPin,
  MessageCircle,
  ArrowLeft,
  HandMetal,
  CalendarClock,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { updateLeadStatus, markAsContacted, addLeadActivity, updateLeadDetails } from "../actions";
import type { Lead, LeadActivity, LeadStatus, VerlustGrund, LeadActivityTyp } from "@/lib/types/database";

interface LeadDetailProps {
  lead: Lead;
  activities: LeadActivity[];
  assigneeName?: string | null;
  isStaff?: boolean;
}

export function LeadDetail({ lead, activities, assigneeName, isStaff }: LeadDetailProps) {
  const router = useRouter();
  const quelleLabel =
    LEAD_QUELLEN.find((q) => q.value === lead.quelle)?.label ?? lead.quelle;
  const showContactButton =
    lead.status === "neu" && !lead.first_contact_at;

  // Wiedervorlage date state
  const [wiedervorlageDate, setWiedervorlageDate] = useState(
    lead.naechste_aktion_am
      ? new Date(lead.naechste_aktion_am).toISOString().split("T")[0]
      : ""
  );
  const [savingWiedervorlage, setSavingWiedervorlage] = useState(false);

  async function handleStatusChange(data: {
    status: LeadStatus;
    auftragswert?: number;
    verlust_grund?: VerlustGrund;
  }) {
    const result = await updateLeadStatus(lead.id, data);
    if (result?.error) {
      throw new Error(result.error);
    }
    router.refresh();
  }

  async function handleMarkContacted() {
    const result = await markAsContacted(lead.id);
    if (result?.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Als kontaktiert markiert — SLA-Uhr gestoppt");
    router.refresh();
  }

  async function handleAddActivity(data: {
    typ: LeadActivityTyp;
    inhalt: string;
  }) {
    const result = await addLeadActivity(lead.id, data);
    if (result?.error) {
      throw new Error(result.error);
    }
    router.refresh();
  }

  async function handleWiedervorlageChange(dateStr: string) {
    setWiedervorlageDate(dateStr);
    if (!dateStr) return;

    setSavingWiedervorlage(true);
    try {
      const isoDate = new Date(dateStr + "T09:00:00").toISOString();
      const result = await updateLeadDetails(lead.id, {
        naechste_aktion_am: isoDate,
      });
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success("Wiedervorlage gesetzt");
        router.refresh();
      }
    } catch {
      toast.error("Wiedervorlage konnte nicht gespeichert werden");
    }
    setSavingWiedervorlage(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Zurück */}
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Zurück zu allen Leads
      </Link>

      {/* Kopf */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {lead.vorname} {lead.nachname}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {lead.ort && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {lead.plz && `${lead.plz} `}
                  {lead.ort}
                </span>
              )}
              <span>·</span>
              <span>{quelleLabel}</span>
              {lead.campaign && (
                <>
                  <span>·</span>
                  <span>{lead.campaign}</span>
                </>
              )}
            </div>
          </div>
          <SlaBadge
            createdAt={lead.created_at}
            firstContactAt={lead.first_contact_at}
            className="text-sm px-3 py-1"
          />
        </div>

        {/* Kontakt-Buttons */}
        <div className="flex flex-wrap gap-2">
          {lead.telefon && (
            <Button
              variant="outline"
              size="sm"
              render={<a href={`tel:${lead.telefon}`} />}
            >
              <Phone className="mr-1.5 h-3.5 w-3.5" />
              {lead.telefon}
            </Button>
          )}
          {lead.telefon && (
            <Button
              variant="outline"
              size="sm"
              render={
                <a
                  href={`https://wa.me/${lead.telefon.replace(/[^0-9+]/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
              WhatsApp
            </Button>
          )}
          {lead.email && (
            <Button
              variant="outline"
              size="sm"
              render={<a href={`mailto:${lead.email}`} />}
            >
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              {lead.email}
            </Button>
          )}
        </div>

        {/* Kontaktiert-Button */}
        {showContactButton && (
          <Button
            onClick={handleMarkContacted}
            className="w-full sm:w-auto bg-signal text-signal-foreground hover:bg-signal/90"
            size="lg"
          >
            <HandMetal className="mr-2 h-4 w-4" />
            Als kontaktiert markieren
          </Button>
        )}
      </div>

      <Separator />

      {/* Status + Details */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Status</p>
            <StatusSelect
              currentStatus={lead.status}
              onStatusChange={handleStatusChange}
            />
          </div>

          {lead.anliegen && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Anliegen</p>
              <p className="text-sm">{lead.anliegen}</p>
            </div>
          )}

          {lead.angebotswert != null && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Angebotswert</p>
              <p className="text-sm font-mono font-medium">
                {formatCurrency(lead.angebotswert)}
              </p>
            </div>
          )}

          {lead.auftragswert != null && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Auftragswert</p>
              <p className="text-sm font-mono font-medium text-success">
                {formatCurrency(lead.auftragswert)}
              </p>
            </div>
          )}

          {lead.verlust_grund && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Verlustgrund</p>
              <p className="text-sm">
                {lead.verlust_grund.replace(/_/g, " ")}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Erstellt</p>
            <p className="text-sm font-mono">
              {new Date(lead.created_at).toLocaleString("de-DE", {
                timeZone: "Europe/Berlin",
              })}
            </p>
          </div>
          {lead.first_contact_at && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Erstkontakt
              </p>
              <p className="text-sm font-mono">
                {new Date(lead.first_contact_at).toLocaleString("de-DE", {
                  timeZone: "Europe/Berlin",
                })}
              </p>
            </div>
          )}

          {/* Zugewiesen an */}
          <div>
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <User className="h-3 w-3" />
              Zugewiesen an
            </p>
            <p className="text-sm">
              {assigneeName ?? "Nicht zugewiesen"}
            </p>
          </div>

          {/* Wiedervorlage */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              Wiedervorlage
            </p>
            {lead.naechste_aktion_am && (
              <p className="text-sm font-mono mb-1.5">
                {new Date(lead.naechste_aktion_am).toLocaleDateString("de-DE", {
                  timeZone: "Europe/Berlin",
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </p>
            )}
            {!lead.naechste_aktion_am && (
              <p className="text-sm text-muted-foreground mb-1.5">
                Keine Wiedervorlage gesetzt
              </p>
            )}
            <Input
              type="date"
              value={wiedervorlageDate}
              onChange={(e) => handleWiedervorlageChange(e.target.value)}
              disabled={savingWiedervorlage}
              className="h-8 w-40 text-sm"
              min={new Date().toISOString().split("T")[0]}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Aktivitätsverlauf */}
      <div>
        <h2 className="text-sm font-medium mb-3">Aktivitäten</h2>
        <ActivityFeed
          activities={activities}
          onAddActivity={handleAddActivity}
        />
      </div>
    </div>
  );
}
