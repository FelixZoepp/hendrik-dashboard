"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AUSWAHL_KLASSE } from "@/components/zugaenge/stil";
import type { Company } from "@/lib/types/database";
import { firmaSpeichern, type FirmaStatus } from "./actions";

const START: FirmaStatus = { fehler: null, gespeichert: false };

const FELDER: { name: keyof Company; label: string; typ?: string; platzhalter?: string }[] = [
  { name: "ansprechpartner", label: "Ansprechpartner", platzhalter: "Vor- und Nachname" },
  { name: "telefon", label: "Telefon", typ: "tel" },
  { name: "email", label: "E-Mail", typ: "email" },
  { name: "branche", label: "Gewerk", platzhalter: "z. B. Dachdecker" },
  { name: "ort", label: "Ort" },
  { name: "region", label: "Region", platzhalter: "z. B. Raum Hannover" },
];

export function FirmaFormular({ firma }: { firma?: Company }) {
  const [status, aktion, laeuft] = useActionState(firmaSpeichern, START);

  return (
    <form action={aktion} className="space-y-4">
      {firma && <input type="hidden" name="id" value={firma.id} />}
      {status.fehler && (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{status.fehler}</p>
      )}
      {status.gespeichert && <p className="rounded-xl bg-accent px-3 py-2 text-sm text-accent-foreground">Gespeichert.</p>}
      <div className="space-y-2">
        <Label htmlFor="f-name">Firmenname</Label>
        <Input id="f-name" name="name" required defaultValue={firma?.name ?? ""} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {FELDER.map((f) => (
          <div key={f.name} className="space-y-2">
            <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
            <Input
              id={`f-${f.name}`}
              name={f.name}
              type={f.typ ?? "text"}
              placeholder={f.platzhalter}
              defaultValue={(firma?.[f.name] as string | null | undefined) ?? ""}
            />
          </div>
        ))}
        <div className="space-y-2">
          <Label htmlFor="f-status">Status</Label>
          <select id="f-status" name="status" defaultValue={firma?.status ?? "onboarding"} className={AUSWAHL_KLASSE}>
            <option value="onboarding">Onboarding</option>
            <option value="aktiv">Aktiv</option>
            <option value="pausiert">Pausiert</option>
            <option value="gekuendigt">Gekündigt</option>
          </select>
        </div>
      </div>
      <Button type="submit" disabled={laeuft}>
        {laeuft ? "Wird gespeichert…" : firma ? "Speichern" : "Kunden anlegen"}
      </Button>
    </form>
  );
}

export function NeuerKundeDialog() {
  const [offen, setOffen] = useState(false);
  return (
    <Dialog open={offen} onOpenChange={setOffen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        Neuen Kunden anlegen
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Neuen Kunden anlegen</DialogTitle>
        </DialogHeader>
        <FirmaFormular />
      </DialogContent>
    </Dialog>
  );
}
