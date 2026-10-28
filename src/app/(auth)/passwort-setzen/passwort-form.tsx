"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwortSetzen, type PasswortStatus } from "./actions";

export function PasswortForm({
  tokenHash,
  typ,
  titel,
}: {
  tokenHash: string | null;
  typ: "invite" | "recovery";
  titel: string;
}) {
  const [status, aktion, laeuft] = useActionState<PasswortStatus, FormData>(passwortSetzen, { fehler: null });

  return (
    <div className="fern-card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">{titel}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Mindestens 8 Zeichen. Danach bist du direkt angemeldet.</p>

      {status.fehler && (
        <p className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {status.fehler}
        </p>
      )}

      <form action={aktion} className="mt-6 space-y-4">
        {tokenHash && (
          <>
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={typ} />
          </>
        )}
        <div className="space-y-2">
          <Label htmlFor="passwort">Neues Passwort</Label>
          <Input id="passwort" name="passwort" type="password" minLength={8} required autoComplete="new-password" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wiederholung">Passwort wiederholen</Label>
          <Input id="wiederholung" name="wiederholung" type="password" minLength={8} required autoComplete="new-password" />
        </div>
        <Button type="submit" className="h-10 w-full" disabled={laeuft}>
          {laeuft ? "Wird gespeichert…" : "Passwort speichern"}
        </Button>
      </form>
    </div>
  );
}
