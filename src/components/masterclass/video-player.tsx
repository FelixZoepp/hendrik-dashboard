"use client";

import { useMemo, useState } from "react";
import { ListOrdered, PlayCircle } from "lucide-react";
import { formatZeit, videoEinbettung, type Zeitmarke } from "@/lib/masterclass/logik";

/** Video oben in der Lektion: YouTube/Vimeo/Loom per iframe, MP4 per <video>. Zeitmarken springen. */
export function VideoPlayer({
  url,
  titel,
  zeitmarken = [],
}: {
  url: string | null;
  titel: string;
  zeitmarken?: Zeitmarke[];
}) {
  const [start, setStart] = useState(0);
  const video = useMemo(() => videoEinbettung(url, start), [url, start]);

  return (
    <div className="space-y-3">
      <div className="fern-card overflow-hidden">
        {video ? (
          <div className="aspect-video bg-black">
            {video.art === "iframe" ? (
              <iframe
                key={video.src}
                src={video.src}
                title={titel}
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                allowFullScreen
                className="h-full w-full"
              />
            ) : (
              <video key={video.src} src={video.src} controls playsInline preload="metadata" className="h-full w-full" />
            )}
          </div>
        ) : (
          <div className="grid aspect-video place-items-center bg-muted text-muted-foreground">
            <div className="text-center">
              <PlayCircle className="mx-auto h-10 w-10" />
              <p className="mt-2 text-sm">Video folgt</p>
            </div>
          </div>
        )}
      </div>

      {video && zeitmarken.length > 0 && (
        <div className="fern-card p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ListOrdered className="h-4 w-4 text-primary" /> Kapitel im Video
          </h2>
          <ul className="mt-2 space-y-1">
            {zeitmarken.map((z) => (
              <li key={`${z.sekunden}-${z.titel}`}>
                <button
                  type="button"
                  onClick={() => setStart(z.sekunden)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-muted"
                >
                  <span className="w-14 shrink-0 font-mono text-sm font-medium text-primary">{formatZeit(z.sekunden)}</span>
                  <span className="text-sm">{z.titel}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
