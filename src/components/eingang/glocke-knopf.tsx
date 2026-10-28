"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { benachrichtigungenGelesen } from "./aktionen";

export interface Meldung {
  id: string;
  typ: string;
  titel: string;
  text: string | null;
  link: string | null;
  gelesen_am: string | null;
  created_at: string;
}

function wann(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const std = Math.round(min / 60);
  if (std < 24) return `vor ${std} Std.`;
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function GlockeKnopf({ meldungen, nurAnsehen }: { meldungen: Meldung[]; nurAnsehen: boolean }) {
  const [offen, setOffen] = useState(false);
  const [, starte] = useTransition();
  const ungelesen = meldungen.filter((m) => !m.gelesen_am).length;

  const gelesen = (id?: string) => {
    if (nurAnsehen) return;
    starte(() => benachrichtigungenGelesen(id));
  };

  return (
    <Popover open={offen} onOpenChange={setOffen}>
      <PopoverTrigger
        className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-foreground outline-none transition-colors hover:bg-muted"
        aria-label={ungelesen ? `${ungelesen} neue Meldungen` : "Meldungen"}
      >
        <Bell className="size-5" />
        {ungelesen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
            {ungelesen > 9 ? "9+" : ungelesen}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="text-[15px] font-semibold">Meldungen</p>
          {ungelesen > 0 && !nurAnsehen && (
            <button type="button" onClick={() => gelesen()} className="text-xs font-medium text-primary hover:underline">
              Alle gelesen
            </button>
          )}
        </div>
        {meldungen.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Noch keine Meldungen. Neue Anfragen erscheinen hier.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {meldungen.map((m) => {
              const inhalt = (
                <>
                  <span className="flex items-start gap-2">
                    {!m.gelesen_am && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                    <span className={cn("text-sm", m.gelesen_am ? "text-muted-foreground" : "font-semibold")}>{m.titel}</span>
                  </span>
                  {m.text && <span className="mt-0.5 block text-sm text-muted-foreground">{m.text}</span>}
                  <span className="mt-1 block text-xs text-muted-foreground" suppressHydrationWarning>{wann(m.created_at)}</span>
                </>
              );
              return (
                <li key={m.id}>
                  {m.link && m.link.startsWith("/") && !m.link.startsWith("//") && !m.link.startsWith("/\\") ? (
                    <Link
                      href={m.link}
                      onClick={() => {
                        setOffen(false);
                        if (!m.gelesen_am) gelesen(m.id);
                      }}
                      className="block px-4 py-3 hover:bg-muted"
                    >
                      {inhalt}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{inhalt}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
