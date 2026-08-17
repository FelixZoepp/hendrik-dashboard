"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle2 } from "lucide-react";

export default function ZugaengeFormPage() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [data, setData] = useState<Record<string, string>>({});

  function update(key: string, value: string) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!data.domain_registrar) {
      toast.error("Bitte gib den Domain-Registrar an");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("form_submissions").insert({
      typ: "zugaenge",
      payload: data,
    });

    if (error) {
      toast.error("Fehler beim Absenden");
      setLoading(false);
      return;
    }

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <Card className="text-center">
        <CardHeader>
          <CheckCircle2 className="mx-auto h-12 w-12 text-success mb-2" />
          <CardTitle>Zugangsdaten erhalten</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Danke! Wir haben deine Angaben erhalten und richten alles ein.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Zugänge & Technik</CardTitle>
        <CardDescription>
          Damit wir loslegen können, brauchen wir ein paar technische Infos von
          dir. Fülle bitte aus, was du weißt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Domain-Registrar */}
          <div className="space-y-1.5">
            <Label>Domain-Registrar *</Label>
            <Input
              value={data.domain_registrar ?? ""}
              onChange={(e) => update("domain_registrar", e.target.value)}
              placeholder="z. B. IONOS, Strato, United Domains…"
            />
          </div>

          {/* Domain-Zugangsdaten */}
          <div className="space-y-1.5">
            <Label>Domain-Zugangsdaten</Label>
            <Textarea
              value={data.domain_zugangsdaten ?? ""}
              onChange={(e) => update("domain_zugangsdaten", e.target.value)}
              placeholder="Login-URL, Benutzername, Passwort…"
              rows={3}
            />
          </div>

          {/* Google Ads MCC */}
          <div className="space-y-1.5">
            <Label>Google Ads MCC vorhanden?</Label>
            <Select
              value={data.google_ads_mcc ?? ""}
              onValueChange={(v) => v && update("google_ads_mcc", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Auswählen…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ja">Ja</SelectItem>
                <SelectItem value="nein">Nein</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {data.google_ads_mcc === "ja" && (
            <div className="space-y-1.5">
              <Label>MCC-ID</Label>
              <Input
                value={data.google_ads_mcc_id ?? ""}
                onChange={(e) => update("google_ads_mcc_id", e.target.value)}
                placeholder="z. B. 123-456-7890"
              />
            </div>
          )}

          {/* Google Analytics */}
          <div className="space-y-1.5">
            <Label>Google Analytics vorhanden?</Label>
            <Select
              value={data.google_analytics ?? ""}
              onValueChange={(v) => v && update("google_analytics", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Auswählen…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ja">Ja</SelectItem>
                <SelectItem value="nein">Nein</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Meta Business Manager */}
          <div className="space-y-1.5">
            <Label>Meta Business Manager vorhanden?</Label>
            <Select
              value={data.meta_business_manager ?? ""}
              onValueChange={(v) => v && update("meta_business_manager", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Auswählen…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ja">Ja</SelectItem>
                <SelectItem value="nein">Nein</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {data.meta_business_manager === "ja" && (
            <div className="space-y-1.5">
              <Label>Meta Business Manager ID</Label>
              <Input
                value={data.meta_business_manager_id ?? ""}
                onChange={(e) =>
                  update("meta_business_manager_id", e.target.value)
                }
                placeholder="z. B. 123456789012345"
              />
            </div>
          )}

          {/* Telefonnummer Calltracking */}
          <div className="space-y-1.5">
            <Label>Telefonnummer für Calltracking</Label>
            <Input
              type="tel"
              value={data.telefon_calltracking ?? ""}
              onChange={(e) => update("telefon_calltracking", e.target.value)}
              placeholder="z. B. +49 123 4567890"
            />
          </div>

          {/* Sonstige Hinweise */}
          <div className="space-y-1.5">
            <Label>Sonstige Hinweise</Label>
            <Textarea
              value={data.sonstige_hinweise ?? ""}
              onChange={(e) => update("sonstige_hinweise", e.target.value)}
              placeholder="Gibt es noch etwas, das wir wissen sollten?"
              rows={4}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Wird gesendet…" : "Zugangsdaten absenden"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
