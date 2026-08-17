"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const STEPS = [
  "Firmendaten",
  "Leistungen & Gebiet",
  "Marketing-Details",
  "Zugänge & Dateien",
] as const;

export default function AfterCloseFormPage() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, string>>({});
  const router = useRouter();

  function update(key: string, value: string) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setLoading(true);
    const supabase = createClient();

    const { error } = await supabase.from("form_submissions").insert({
      typ: "after_close",
      payload: data,
    });

    if (error) {
      toast.error("Fehler beim Absenden", { description: error.message });
      setLoading(false);
      return;
    }

    toast.success("Formular erfolgreich gesendet!");
    router.push("/forms/after-close/danke");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>After-Close-Formular</CardTitle>
        <CardDescription>
          Schritt {step + 1} von {STEPS.length} — {STEPS[step]}
        </CardDescription>
        {/* Progress */}
        <div className="flex gap-1 mt-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Firmenname *</Label>
                <Input
                  value={data.firmenname ?? ""}
                  onChange={(e) => update("firmenname", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Rechtsform</Label>
                <Input
                  value={data.rechtsform ?? ""}
                  onChange={(e) => update("rechtsform", e.target.value)}
                  placeholder="z.B. GmbH, Einzelunternehmen"
                />
              </div>
              <div className="space-y-1.5">
                <Label>USt-ID</Label>
                <Input
                  value={data.ust_id ?? ""}
                  onChange={(e) => update("ust_id", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ansprechpartner *</Label>
                <Input
                  value={data.ansprechpartner ?? ""}
                  onChange={(e) => update("ansprechpartner", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Handynummer *</Label>
                <Input
                  type="tel"
                  value={data.handynummer ?? ""}
                  onChange={(e) => update("handynummer", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>E-Mail *</Label>
                <Input
                  type="email"
                  value={data.email ?? ""}
                  onChange={(e) => update("email", e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Rechnungsadresse</Label>
              <Textarea
                value={data.rechnungsadresse ?? ""}
                onChange={(e) => update("rechnungsadresse", e.target.value)}
                rows={2}
              />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="space-y-1.5">
              <Label>Gewerke / Leistungen *</Label>
              <Textarea
                value={data.gewerke ?? ""}
                onChange={(e) => update("gewerke", e.target.value)}
                placeholder="z.B. Dachdecker, Klempner, Badsanierung…"
                rows={3}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Einzugsgebiet *</Label>
                <Input
                  value={data.einzugsgebiet ?? ""}
                  onChange={(e) => update("einzugsgebiet", e.target.value)}
                  placeholder="z.B. München + 50km Radius"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Kapazität (Aufträge/Monat)</Label>
                <Input
                  type="number"
                  value={data.kapazitaet ?? ""}
                  onChange={(e) => update("kapazitaet", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ø Auftragswert (EUR)</Label>
                <Input
                  type="number"
                  value={data.avg_auftragswert ?? ""}
                  onChange={(e) => update("avg_auftragswert", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Was soll NICHT angefragt werden?</Label>
              <Textarea
                value={data.ausschluesse ?? ""}
                onChange={(e) => update("ausschluesse", e.target.value)}
                rows={2}
              />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="space-y-1.5">
              <Label>Bestehende Website</Label>
              <Input
                value={data.website ?? ""}
                onChange={(e) => update("website", e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Google Business Profil vorhanden?</Label>
              <Select
                value={data.google_business ?? ""}
                onValueChange={(v) => v && update("google_business", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Auswählen…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ja">Ja</SelectItem>
                  <SelectItem value="nein">Nein</SelectItem>
                  <SelectItem value="unsicher">Unsicher</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Referenzen / Projektbilder</Label>
              <Textarea
                value={data.referenzen ?? ""}
                onChange={(e) => update("referenzen", e.target.value)}
                placeholder="Links zu Bildern oder Beschreibung von Referenzprojekten"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Gewünschter Starttermin</Label>
              <Input
                type="date"
                value={data.starttermin ?? ""}
                onChange={(e) => update("starttermin", e.target.value)}
              />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="space-y-1.5">
              <Label>Domain-Registrar</Label>
              <Input
                value={data.domain_registrar ?? ""}
                onChange={(e) => update("domain_registrar", e.target.value)}
                placeholder="z.B. IONOS, Strato, united-domains…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Zugangsdaten / Notizen</Label>
              <Textarea
                value={data.zugangsdaten ?? ""}
                onChange={(e) => update("zugangsdaten", e.target.value)}
                placeholder="Login-Daten oder wo wir sie finden"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Logo vorhanden?</Label>
              <Select
                value={data.logo ?? ""}
                onValueChange={(v) => v && update("logo", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Auswählen…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ja_hochaufloesend">Ja, hochauflösend</SelectItem>
                  <SelectItem value="ja_niedrig">Ja, aber niedrige Qualität</SelectItem>
                  <SelectItem value="nein">Nein</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sonstige Anmerkungen</Label>
              <Textarea
                value={data.anmerkungen ?? ""}
                onChange={(e) => update("anmerkungen", e.target.value)}
                rows={3}
              />
            </div>
          </>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-2">
          <Button
            variant="outline"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
          >
            Zurück
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)}>
              Weiter
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? "Wird gesendet…" : "Absenden"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
