"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEAD_STATUS_CONFIG } from "@/lib/lead-utils";
import {
  Phone,
  FileText,
  ArrowRightLeft,
  Mail,
  MessageCircle,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import type { LeadActivity, LeadActivityTyp } from "@/lib/types/database";

const ACTIVITY_ICONS: Record<LeadActivityTyp, typeof Phone> = {
  anruf: Phone,
  notiz: FileText,
  status_wechsel: ArrowRightLeft,
  email: Mail,
  whatsapp: MessageCircle,
};

const ACTIVITY_LABELS: Record<LeadActivityTyp, string> = {
  anruf: "Anruf",
  notiz: "Notiz",
  status_wechsel: "Status geändert",
  email: "E-Mail",
  whatsapp: "WhatsApp",
};

const MANUAL_TYPES: { value: LeadActivityTyp; label: string }[] = [
  { value: "anruf", label: "Anruf" },
  { value: "notiz", label: "Notiz" },
  { value: "email", label: "E-Mail" },
  { value: "whatsapp", label: "WhatsApp" },
];

interface ActivityFeedProps {
  activities: LeadActivity[];
  onAddActivity: (data: {
    typ: LeadActivityTyp;
    inhalt: string;
  }) => Promise<void>;
}

export function ActivityFeed({
  activities,
  onAddActivity,
}: ActivityFeedProps) {
  const [typ, setTyp] = useState<LeadActivityTyp>("notiz");
  const [inhalt, setInhalt] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inhalt.trim()) return;

    setLoading(true);
    try {
      await onAddActivity({ typ, inhalt: inhalt.trim() });
      setInhalt("");
      toast.success("Aktivität gespeichert");
    } catch {
      toast.error("Konnte nicht gespeichert werden");
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      {/* Eingabe */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex gap-2">
          <Select
            value={typ}
            onValueChange={(v) => setTyp(v as LeadActivityTyp)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MANUAL_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" disabled={loading || !inhalt.trim()}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Speichern
          </Button>
        </div>
        <Textarea
          placeholder="Was ist passiert?"
          value={inhalt}
          onChange={(e) => setInhalt(e.target.value)}
          rows={2}
          className="resize-none text-sm"
        />
      </form>

      {/* Feed */}
      <div className="space-y-0">
        {activities.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Noch keine Aktivitäten
          </p>
        ) : (
          activities.map((activity, i) => {
            const Icon = ACTIVITY_ICONS[activity.typ];
            const isStatusChange = activity.typ === "status_wechsel";
            return (
              <div
                key={activity.id}
                className={cn(
                  "relative flex gap-3 py-3",
                  i < activities.length - 1 && "border-b border-border/50"
                )}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">
                      {ACTIVITY_LABELS[activity.typ]}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(activity.created_at), {
                        addSuffix: true,
                        locale: de,
                      })}
                    </span>
                  </div>
                  {isStatusChange && activity.alt_status && activity.neu_status ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "inline-block rounded px-1 py-0.5 text-[10px] font-medium",
                          LEAD_STATUS_CONFIG[activity.alt_status].color
                        )}
                      >
                        {LEAD_STATUS_CONFIG[activity.alt_status].label}
                      </span>
                      <span className="mx-1.5">→</span>
                      <span
                        className={cn(
                          "inline-block rounded px-1 py-0.5 text-[10px] font-medium",
                          LEAD_STATUS_CONFIG[activity.neu_status].color
                        )}
                      >
                        {LEAD_STATUS_CONFIG[activity.neu_status].label}
                      </span>
                    </p>
                  ) : (
                    activity.inhalt && (
                      <p className="mt-0.5 text-xs text-muted-foreground whitespace-pre-wrap">
                        {activity.inhalt}
                      </p>
                    )
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
