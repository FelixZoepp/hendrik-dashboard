"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/sales";

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus("Verbinde mit Supabase...");

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!url || !key) {
        toast.error("Konfigurationsfehler", {
          description: `Supabase URL: ${url ? "OK" : "FEHLT"}, Key: ${key ? "OK" : "FEHLT"}`,
        });
        setLoading(false);
        setStatus("");
        return;
      }

      setStatus("Sende Login...");
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error("Login fehlgeschlagen", {
          description: error.message,
        });
        setLoading(false);
        setStatus("");
        return;
      }

      if (!data.session) {
        toast.error("Keine Session erhalten");
        setLoading(false);
        setStatus("");
        return;
      }

      setStatus("Login erfolgreich, leite weiter...");
      window.location.href = next;
    } catch (err) {
      toast.error("Verbindungsfehler", {
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
      });
      setLoading(false);
      setStatus("");
    }
  }

  async function handleMagicLink() {
    if (!email) {
      toast.error("Bitte E-Mail eingeben");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });

    if (error) {
      toast.error("Fehler beim Versand", { description: error.message });
      setLoading(false);
      return;
    }

    setMagicLinkSent(true);
    setLoading(false);
  }

  if (magicLinkSent) {
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Link gesendet</CardTitle>
          <CardDescription>
            Wir haben dir einen Anmeldelink an{" "}
            <span className="font-medium text-foreground">{email}</span>{" "}
            geschickt. Prüfe dein Postfach.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setMagicLinkSent(false)}
          >
            Zurück zum Login
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">Hoffman Solutions</CardTitle>
        <CardDescription>
          Melde dich an, um fortzufahren.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin} className="space-y-4">
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
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Wird angemeldet…" : "Anmelden"}
          </Button>
          {status && (
            <p className="text-xs text-muted-foreground text-center">
              {status}
            </p>
          )}
        </form>
        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">oder</span>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={handleMagicLink}
          disabled={loading}
        >
          Magic Link per E-Mail
        </Button>
      </CardContent>
    </Card>
  );
}
