"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AUSWAHL_KLASSE } from "@/components/zugaenge/stil";
import type { AktionsStatus } from "./aktionen";

const START: AktionsStatus = { fehler: null, meldung: null };

type Aktion = (vorher: AktionsStatus, fd: FormData) => Promise<AktionsStatus>;

/** Formular mit Rückmeldung (Fehler/Meldung) unter dem Knopf. */
export function AktionsFormular({
  aktion,
  companyId,
  knopf,
  variante = "default",
  className,
  children,
}: {
  aktion: Aktion;
  companyId: string;
  knopf: string;
  variante?: "default" | "secondary" | "outline";
  className?: string;
  children?: React.ReactNode;
}) {
  const [status, ausfuehren, laeuft] = useActionState(aktion, START);
  return (
    <form action={ausfuehren} className={cn("space-y-2", className)}>
      <input type="hidden" name="company_id" value={companyId} />
      <div className="flex flex-wrap items-end gap-2">
        {children}
        <Button type="submit" size="sm" variant={variante} disabled={laeuft}>
          {laeuft && <Loader2 className="animate-spin" />}
          {knopf}
        </Button>
      </div>
      {status.fehler && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{status.fehler}</p>}
      {status.meldung && <p className="rounded-xl bg-accent px-3 py-2 text-sm text-accent-foreground">{status.meldung}</p>}
    </form>
  );
}

/** Auswahl einer noch freien Kampagne aus dem zentralen Konto (Name wird mitgeschickt). */
export function KampagnenAuswahl({
  aktion,
  companyId,
  kampagnen,
}: {
  aktion: Aktion;
  companyId: string;
  kampagnen: Array<{ id: string; name: string; status?: string | null }>;
}) {
  const [id, setId] = useState("");
  const name = kampagnen.find((k) => k.id === id)?.name ?? "";
  return (
    <AktionsFormular aktion={aktion} companyId={companyId} knopf="Zuordnen">
      <input type="hidden" name="plattform" value="meta" />
      <input type="hidden" name="kampagne_id" value={id} />
      <input type="hidden" name="kampagne_name" value={name} />
      <label className="min-w-0 flex-1 basis-64">
        <span className="sr-only">Kampagne wählen</span>
        <select className={AUSWAHL_KLASSE} value={id} onChange={(e) => setId(e.target.value)} required>
          <option value="">Kampagne aus dem zentralen Konto wählen …</option>
          {kampagnen.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
              {k.status && k.status !== "ACTIVE" ? ` (${k.status === "PAUSED" ? "pausiert" : k.status.toLowerCase()})` : ""}
            </option>
          ))}
        </select>
      </label>
    </AktionsFormular>
  );
}
