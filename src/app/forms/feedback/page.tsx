"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const NPS_SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export default function FeedbackFormPage() {
  const [nps, setNps] = useState<number | null>(null);
  const [kommentar, setKommentar] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (nps === null) {
      toast.error("Bitte wähle eine Bewertung");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("form_submissions").insert({
      typ: "feedback",
      payload: { nps, kommentar },
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
          <CardTitle>Danke für dein Feedback!</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Deine Rückmeldung hilft uns, besser zu werden.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wie zufrieden bist du?</CardTitle>
        <CardDescription>
          Auf einer Skala von 0 bis 10: Wie wahrscheinlich ist es, dass du
          Hoffman Solutions weiterempfiehlst?
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <div className="flex gap-1">
              {NPS_SCALE.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNps(n)}
                  className={`flex-1 h-10 rounded-md border text-sm font-mono font-medium transition-colors ${
                    nps === n
                      ? n <= 6
                        ? "bg-destructive/20 border-destructive text-destructive"
                        : n <= 8
                          ? "bg-warning/20 border-warning text-warning-foreground"
                          : "bg-success/20 border-success text-success"
                      : "bg-card hover:bg-muted"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Gar nicht wahrscheinlich</span>
              <span>Sehr wahrscheinlich</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Was können wir besser machen?</Label>
            <Textarea
              value={kommentar}
              onChange={(e) => setKommentar(e.target.value)}
              rows={4}
              placeholder="Dein Feedback…"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Wird gesendet…" : "Feedback absenden"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
