"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
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

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://kfnpynqaprpzxffcxcsj.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbnB5bnFhcHJwenhmZmN4Y3NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5ODE0ODQsImV4cCI6MjEwMjU1NzQ4NH0.usCIKdjh1t7GX_PsGg84wW47ky5KazbAaO5WO6zrznM";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatusMsg("Verbinde...");

    try {
      const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      setStatusMsg("Sende Login...");
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error("Login fehlgeschlagen", { description: error.message });
        setLoading(false);
        setStatusMsg("");
        return;
      }

      if (!data.session) {
        toast.error("Keine Session erhalten");
        setLoading(false);
        setStatusMsg("");
        return;
      }

      setStatusMsg("Erfolgreich! Leite weiter...");
      window.location.href = "/sales";
    } catch (err) {
      toast.error("Fehler", {
        description: err instanceof Error ? err.message : "Unbekannt",
      });
      setLoading(false);
      setStatusMsg("");
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">Hoffman Solutions</CardTitle>
        <CardDescription>Melde dich an, um fortzufahren.</CardDescription>
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
          {statusMsg && (
            <p className="text-xs text-center text-muted-foreground">
              {statusMsg}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
