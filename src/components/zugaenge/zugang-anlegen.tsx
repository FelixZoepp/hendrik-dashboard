"use client";

import { useActionState, useState } from "react";
import { Check, Copy, KeyRound, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ZugangErgebnis } from "@/lib/zugaenge";
import { AUSWAHL_KLASSE } from "./stil";

const START: ZugangErgebnis = { fehler: null, link: null, email: null, neu: false };

export function LinkAnzeige({ link, email, neu }: { link: string; email: string | null; neu: boolean }) {
  const [kopiert, setKopiert] = useState(false);
  return (
    <div className="space-y-3 rounded-2xl bg-accent p-4 text-sm">
      <p className="font-medium text-accent-foreground">
        {neu ? "Zugang angelegt." : "Neuer Link erzeugt."} Link für {email}:
      </p>
      <div className="flex gap-2">
        <Input readOnly value={link} className="bg-background font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setKopiert(true);
          }}
        >
          {kopiert ? <Check /> : <Copy />}
          {kopiert ? "Kopiert" : "Kopieren"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Es wurde keine E-Mail verschickt. Gib den Link selbst weiter (z. B. per WhatsApp). Er gilt nur einmal und läuft
        nach kurzer Zeit ab – dann einfach einen neuen erzeugen.
      </p>
    </div>
  );
}

export function ZugangAnlegen({
  aktion,
  rollen,
  companyId,
  titel = "Zugang anlegen",
  knopf = "Zugang anlegen",
}: {
  aktion: (vorher: ZugangErgebnis, formData: FormData) => Promise<ZugangErgebnis>;
  rollen: { value: string; label: string }[];
  companyId?: string;
  titel?: string;
  knopf?: string;
}) {
  const [offen, setOffen] = useState(false);
  const [schluessel, setSchluessel] = useState(0);

  return (
    <Dialog
      open={offen}
      onOpenChange={(o) => {
        setOffen(o);
        if (!o) setSchluessel((k) => k + 1);
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <UserPlus />
        {knopf}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titel}</DialogTitle>
          <DialogDescription>
            Gibt es die E-Mail schon, wird nur ein neuer Link zum Passwort-Setzen erzeugt.
          </DialogDescription>
        </DialogHeader>
        <ZugangFormular key={schluessel} aktion={aktion} rollen={rollen} companyId={companyId} />
      </DialogContent>
    </Dialog>
  );
}

function ZugangFormular({
  aktion,
  rollen,
  companyId,
}: {
  aktion: (vorher: ZugangErgebnis, formData: FormData) => Promise<ZugangErgebnis>;
  rollen: { value: string; label: string }[];
  companyId?: string;
}) {
  const [status, formAktion, laeuft] = useActionState(aktion, START);

  if (status.link) return <LinkAnzeige link={status.link} email={status.email} neu={status.neu} />;

  return (
    <form action={formAktion} className="space-y-4">
      {companyId && <input type="hidden" name="company_id" value={companyId} />}
      {status.fehler && (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{status.fehler}</p>
      )}
      <div className="space-y-2">
        <Label htmlFor="za-name">Name</Label>
        <Input id="za-name" name="full_name" required placeholder="Vor- und Nachname" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="za-email">E-Mail</Label>
        <Input id="za-email" name="email" type="email" required placeholder="name@firma.de" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="za-rolle">Rolle</Label>
        <select id="za-rolle" name="rolle" className={AUSWAHL_KLASSE} defaultValue={rollen[0]?.value}>
          {rollen.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" className="w-full" disabled={laeuft}>
        <KeyRound />
        {laeuft ? "Wird erzeugt…" : "Link erzeugen"}
      </Button>
    </form>
  );
}
