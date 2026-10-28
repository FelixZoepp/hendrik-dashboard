"use client";

import { useActionState, useState } from "react";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AUSWAHL_KLASSE } from "@/components/zugaenge/stil";
import { hochladen } from "@/components/masterclass/hochladen";
import type { Modul } from "@/lib/masterclass/logik";
import { bildUploadVorbereiten, modulSpeichern, type EditorStatus } from "../../actions";

const START: EditorStatus = { fehler: null, gespeichert: false };

export function ModulFormular({
  modul,
  andere,
  bildVorschau,
}: {
  modul: Modul;
  andere: { id: string; titel: string }[];
  bildVorschau: string | null;
}) {
  const [status, aktion, laeuft] = useActionState(modulSpeichern, START);
  const [bild, setBild] = useState(modul.bild_url ?? "");
  const [vorschau, setVorschau] = useState(bildVorschau);
  const [laedtBild, setLaedt] = useState(false);

  async function bildWaehlen(datei: File | undefined) {
    if (!datei) return;
    if (!datei.type.startsWith("image/")) return toast.error("Bitte ein Bild wählen (JPG, PNG, WebP).");
    setLaedt(true);
    const r = await hochladen((name) => bildUploadVorbereiten(modul.id, name), datei);
    setLaedt(false);
    if ("fehler" in r) return toast.error(r.fehler);
    setBild(r.pfad);
    setVorschau(URL.createObjectURL(datei));
    toast.success("Bild hochgeladen – jetzt speichern.");
  }

  return (
    <form action={aktion} className="fern-card space-y-4 p-5">
      <input type="hidden" name="id" value={modul.id} />
      {status.fehler && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{status.fehler}</p>}
      {status.gespeichert && <p className="rounded-xl bg-accent px-3 py-2 text-sm text-accent-foreground">Gespeichert.</p>}

      <div className="space-y-2">
        <Label htmlFor="m-titel">Titel</Label>
        <Input id="m-titel" name="titel" required maxLength={200} defaultValue={modul.titel} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="m-beschreibung">Beschreibung (kurz, für die Kachel)</Label>
        <Textarea id="m-beschreibung" name="beschreibung" rows={2} defaultValue={modul.beschreibung ?? ""} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="m-bild">Bild (optional)</Label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {vorschau && (
            // eslint-disable-next-line @next/next/no-img-element -- Vorschau (Blob/signierter Link)
            <img src={vorschau} alt="" className="aspect-video w-40 rounded-xl object-cover" />
          )}
          <Input
            id="m-bild"
            name="bild_url"
            value={bild}
            onChange={(e) => {
              setBild(e.target.value);
              setVorschau(/^https:\/\//.test(e.target.value) ? e.target.value : null);
            }}
            placeholder="https://… oder hochladen"
          />
          <label className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 text-sm hover:bg-muted">
            <ImagePlus className="h-4 w-4" />
            {laedtBild ? "Lädt…" : "Hochladen"}
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => bildWaehlen(e.target.files?.[0])} />
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="m-vor">Erst nach Modul … (optional)</Label>
          <select id="m-vor" name="voraussetzung_course_id" defaultValue={modul.voraussetzung_course_id ?? ""} className={AUSWAHL_KLASSE}>
            <option value="">Keine Sperre – sofort frei</option>
            {andere.map((a) => (
              <option key={a.id} value={a.id}>
                {a.titel}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="m-status">Status</Label>
          <select id="m-status" name="status" defaultValue={modul.status} className={AUSWAHL_KLASSE}>
            <option value="entwurf">Entwurf (für Kunden unsichtbar)</option>
            <option value="veroeffentlicht">Veröffentlicht</option>
          </select>
        </div>
      </div>

      <Button type="submit" disabled={laeuft || laedtBild}>
        {laeuft ? "Wird gespeichert…" : "Modul speichern"}
      </Button>
    </form>
  );
}
