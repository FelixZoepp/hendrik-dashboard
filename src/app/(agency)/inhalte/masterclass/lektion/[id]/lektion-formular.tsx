"use client";

import { useActionState, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AUSWAHL_KLASSE } from "@/components/zugaenge/stil";
import { type Lektion, markdownZuHtml, videoEinbettung, zeitmarkenText } from "@/lib/masterclass/logik";
import { cn } from "@/lib/utils";
import { lektionSpeichern, type EditorStatus } from "../../actions";

const START: EditorStatus = { fehler: null, gespeichert: false };

const ANBIETER: Record<string, string> = { youtube: "YouTube", vimeo: "Vimeo", loom: "Loom" };

export function LektionFormular({ lektion, module }: { lektion: Lektion; module: { id: string; titel: string }[] }) {
  const [status, aktion, laeuft] = useActionState(lektionSpeichern, START);
  const [typ, setTyp] = useState(lektion.typ);
  const [video, setVideo] = useState(lektion.video_url ?? "");
  const [md, setMd] = useState(lektion.content_md ?? "");
  const [ansicht, setAnsicht] = useState<"schreiben" | "vorschau">("schreiben");
  const [veroeffentlicht, setVeroeffentlicht] = useState(lektion.status === "veroeffentlicht");

  const erkannt = useMemo(() => (video.trim() ? videoEinbettung(video) : null), [video]);
  // Gleiche Umwandlung wie beim Speichern (Server), Ergebnis ist gefiltertes HTML
  const vorschauHtml = useMemo(() => (ansicht === "vorschau" ? markdownZuHtml(md) : ""), [ansicht, md]);

  return (
    <form action={aktion} className="fern-card space-y-5 p-5">
      <input type="hidden" name="id" value={lektion.id} />
      <input type="hidden" name="status" value={veroeffentlicht ? "veroeffentlicht" : "entwurf"} />
      {status.fehler && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{status.fehler}</p>}
      {status.gespeichert && <p className="rounded-xl bg-accent px-3 py-2 text-sm text-accent-foreground">Gespeichert.</p>}

      <div className="space-y-2">
        <Label htmlFor="l-titel">Titel</Label>
        <Input id="l-titel" name="titel" required maxLength={200} defaultValue={lektion.titel} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="l-modul">Modul</Label>
          <select id="l-modul" name="course_id" defaultValue={lektion.course_id} className={AUSWAHL_KLASSE}>
            {module.map((m) => (
              <option key={m.id} value={m.id}>
                {m.titel}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="l-kapitel">Kapitel im Modul (optional)</Label>
          <Input id="l-kapitel" name="kapitel" maxLength={120} defaultValue={lektion.kapitel ?? ""} placeholder="z. B. Grundlagen" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="l-typ">Art</Label>
          <select
            id="l-typ"
            name="typ"
            value={typ}
            onChange={(e) => setTyp(e.target.value === "text" ? "text" : "video")}
            className={AUSWAHL_KLASSE}
          >
            <option value="video">Video mit Text</option>
            <option value="text">Nur Text</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="l-dauer">Dauer (Min.)</Label>
            <Input id="l-dauer" name="dauer" inputMode="numeric" defaultValue={lektion.dauer ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l-ab">Frei ab Tag</Label>
            <Input id="l-ab" name="freigeschaltet_ab" inputMode="numeric" defaultValue={lektion.freigeschaltet_ab || ""} placeholder="0" />
          </div>
        </div>
      </div>

      {typ === "video" && (
        <div className="space-y-2">
          <Label htmlFor="l-video">Video-Link</Label>
          <Input
            id="l-video"
            name="video_url"
            value={video}
            onChange={(e) => setVideo(e.target.value)}
            placeholder="YouTube, Vimeo, Loom oder https://….mp4"
          />
          {video.trim() && (
            <p className={cn("flex items-center gap-1.5 text-xs", erkannt ? "text-success" : "text-destructive")}>
              {erkannt ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {erkannt
                ? `Erkannt: ${erkannt.art === "datei" ? "Videodatei" : ANBIETER[erkannt.anbieter]}`
                : "Link nicht erkannt – YouTube, Vimeo, Loom oder https-Link auf .mp4/.webm/.mov"}
            </p>
          )}
          <Label htmlFor="l-zeit" className="pt-2">
            Kapitel im Video (optional, eine Zeile je Sprungmarke)
          </Label>
          <Textarea
            id="l-zeit"
            name="zeitmarken"
            rows={3}
            defaultValue={zeitmarkenText(lektion.zeitmarken)}
            placeholder={"0:00 Einstieg\n2:30 Beispiel"}
            className="font-mono text-sm"
          />
        </div>
      )}
      {typ === "text" && <input type="hidden" name="video_url" value={video} />}

      <div className="space-y-2">
        <Label htmlFor="l-beschreibung">Kurzbeschreibung (optional)</Label>
        <Textarea id="l-beschreibung" name="beschreibung" rows={2} defaultValue={lektion.beschreibung ?? ""} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="l-text">Text der Lektion</Label>
          <div className="flex gap-1 rounded-full bg-muted p-0.5 text-xs">
            {(["schreiben", "vorschau"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAnsicht(a)}
                className={cn("rounded-full px-3 py-1", ansicht === a ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {a === "schreiben" ? "Schreiben" : "Vorschau"}
              </button>
            ))}
          </div>
        </div>
        <Textarea
          id="l-text"
          name="content_md"
          rows={14}
          value={md}
          onChange={(e) => setMd(e.target.value)}
          className={cn("font-mono text-sm", ansicht === "vorschau" && "hidden")}
        />
        {ansicht === "vorschau" && (
          <div
            className="min-h-40 rounded-lg border border-border p-4 text-[15px] leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
            // markdownZuHtml filtert das Ergebnis (bereinigeHtml)
            dangerouslySetInnerHTML={{ __html: vorschauHtml || "<p>(leer)</p>" }}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Formatierung: <code>## Überschrift</code> · <code>**fett**</code> · <code>*kursiv*</code> · <code>- Liste</code> ·{" "}
          <code>1. Liste</code> · <code>&gt; Merksatz</code> · <code>[Text](https://…)</code>
        </p>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={veroeffentlicht}
            onChange={(e) => setVeroeffentlicht(e.target.checked)}
            className="h-5 w-5 accent-primary"
          />
          Veröffentlicht (für Kunden sichtbar, wenn auch das Modul veröffentlicht ist)
        </label>
        <Button type="submit" disabled={laeuft} className="h-10 px-5">
          {laeuft ? "Wird gespeichert…" : "Speichern"}
        </Button>
      </div>
    </form>
  );
}
