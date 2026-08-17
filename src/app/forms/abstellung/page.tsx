"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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

export default function AbstellungFormPage() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [data, setData] = useState<Record<string, string>>({});

  function update(key: string, value: string) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data.aktion) {
      toast.error("Bitte wähle eine Aktion");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("form_submissions").insert({
      typ: "abstellung",
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
          <CardTitle>Anfrage eingegangen</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Wir haben deine Anfrage erhalten und melden uns innerhalb von 2
            Werktagen.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vertrag pausieren oder beenden</CardTitle>
        <CardDescription>
          Teile uns mit, wie du vorgehen möchtest. Wir kümmern uns um alles
          Weitere.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Was möchtest du tun? *</Label>
            <Select
              value={data.aktion ?? ""}
              onValueChange={(v) => v && update("aktion", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Auswählen…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pausieren">
                  Kampagnen pausieren (Vertrag bleibt bestehen)
                </SelectItem>
                <SelectItem value="beenden">
                  Vertrag beenden
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Grund *</Label>
            <Select
              value={data.grund ?? ""}
              onValueChange={(v) => v && update("grund", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Auswählen…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kapazitaet">
                  Kapazität ausgelastet
                </SelectItem>
                <SelectItem value="budget">Budget</SelectItem>
                <SelectItem value="saisonpause">Saisonpause</SelectItem>
                <SelectItem value="unzufrieden">
                  Unzufrieden mit dem Service
                </SelectItem>
                <SelectItem value="sonstiges">Sonstiges</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Gewünschtes Datum</Label>
            <Input
              type="date"
              value={data.datum ?? ""}
              onChange={(e) => update("datum", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Feedback / Anmerkungen</Label>
            <Textarea
              value={data.feedback ?? ""}
              onChange={(e) => update("feedback", e.target.value)}
              placeholder="Was können wir besser machen?"
              rows={4}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Wird gesendet…" : "Anfrage absenden"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
