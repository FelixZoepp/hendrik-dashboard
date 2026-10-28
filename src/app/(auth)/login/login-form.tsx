"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function deutscheMeldung(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("invalid login")) return "E-Mail oder Passwort stimmt nicht.";
  if (t.includes("banned")) return "Dein Zugang ist gesperrt. Bitte melde dich bei Hoffmann Solutions.";
  if (t.includes("email not confirmed")) return "Dein Zugang ist noch nicht aktiviert. Nutze den Link, den du bekommen hast.";
  return "Anmeldung hat nicht geklappt. Bitte versuch es noch einmal.";
}

export function LoginForm({
  next,
  fehler,
  hinweis,
}: {
  next: string;
  fehler: string | null;
  hinweis: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(fehler);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMeldung(null);
    try {
      const { data, error } = await createClient().auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        setMeldung(deutscheMeldung(error?.message ?? ""));
        setLoading(false);
        return;
      }
      window.location.href = next;
    } catch {
      setMeldung("Keine Verbindung. Bitte prüfe dein Internet.");
      setLoading(false);
    }
  }

  return (
    <div className="fern-card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Anmelden</h1>
      <p className="mt-1 text-sm text-muted-foreground">Mit deiner E-Mail und deinem Passwort.</p>

      {hinweis && !meldung && (
        <p className="mt-4 rounded-xl bg-accent px-3 py-2 text-sm text-accent-foreground">{hinweis}</p>
      )}
      {meldung && (
        <p className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {meldung}
        </p>
      )}

      <form onSubmit={handleLogin} className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-Mail</Label>
          <Input
            id="email"
            type="email"
            placeholder="name@firma.de"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Passwort</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <Button type="submit" className="h-10 w-full" disabled={loading}>
          {loading ? "Wird angemeldet…" : "Anmelden"}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Passwort vergessen? Sag deinem Ansprechpartner bei Hoffmann Solutions Bescheid – du bekommst einen neuen Link.
      </p>
    </div>
  );
}
