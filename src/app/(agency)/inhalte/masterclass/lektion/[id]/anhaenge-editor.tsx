"use client";

import { useState, useTransition } from "react";
import { Download, Link2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hochladen } from "@/components/masterclass/hochladen";
import type { Anhang } from "@/lib/masterclass/logik";
import { anhaengeSpeichern, anhangUploadVorbereiten } from "../../actions";

export function AnhaengeEditor({ lessonId, anfang }: { lessonId: string; anfang: Anhang[] }) {
  const [liste, setListe] = useState<Anhang[]>(anfang);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [laeuft, starte] = useTransition();

  function speichern(neu: Anhang[], meldung: string) {
    const alt = liste;
    setListe(neu);
    starte(async () => {
      const r = await anhaengeSpeichern(lessonId, neu);
      if (r.fehler) {
        setListe(alt);
        toast.error(r.fehler);
      } else {
        toast.success(meldung);
      }
    });
  }

  async function dateiWaehlen(datei: File | undefined) {
    if (!datei) return;
    starte(async () => {
      const r = await hochladen((n) => anhangUploadVorbereiten(lessonId, n), datei);
      if ("fehler" in r) {
        toast.error(r.fehler);
        return;
      }
      const neu = [...liste, { name: datei.name, pfad: r.pfad }];
      const s = await anhaengeSpeichern(lessonId, neu);
      if (s.fehler) toast.error(s.fehler);
      else {
        setListe(neu);
        toast.success("Datei hinzugefügt.");
      }
    });
  }

  function linkHinzufuegen() {
    const n = name.trim();
    const u = url.trim();
    if (!n || !/^https?:\/\/\S+$/i.test(u)) {
      toast.error("Bitte Name und vollständigen Link (https://…) eingeben.");
      return;
    }
    setName("");
    setUrl("");
    speichern([...liste, { name: n, url: u }], "Link hinzugefügt.");
  }

  return (
    <div className="fern-card space-y-4 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Paperclip className="h-5 w-5 text-primary" /> Anhänge (Downloads)
      </h2>
      {liste.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Anhänge.</p>
      ) : (
        <ul className="space-y-2">
          {liste.map((a, i) => (
            <li key={`${a.pfad ?? a.url}-${i}`} className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2">
              {a.pfad ? <Download className="h-4 w-4 shrink-0 text-primary" /> : <Link2 className="h-4 w-4 shrink-0 text-primary" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{a.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{a.pfad ? "Datei in der Cloud" : a.url}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={laeuft}
                aria-label="Anhang entfernen"
                onClick={() => speichern(liste.filter((_, k) => k !== i), "Anhang entfernt.")}
              >
                <Trash2 className="text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <label className="inline-flex h-10 w-fit cursor-pointer items-center gap-2 rounded-full border border-border px-4 text-sm font-medium hover:bg-muted">
          <Upload className="h-4 w-4" />
          {laeuft ? "Lädt…" : "Datei hochladen (PDF, Vorlage …)"}
          <input
            type="file"
            className="sr-only"
            disabled={laeuft}
            onChange={(e) => {
              void dateiWaehlen(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, z. B. Leitfaden" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          <Button type="button" variant="outline" disabled={laeuft} onClick={linkHinzufuegen}>
            Link hinzufügen
          </Button>
        </div>
      </div>
    </div>
  );
}
