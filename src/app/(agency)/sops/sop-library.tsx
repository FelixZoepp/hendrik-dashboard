"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Search, BookOpen } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

interface Sop {
  id: string;
  titel: string;
  kategorie: string;
  updated_at: string;
}

export function SopLibrary({ sops }: { sops: Sop[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return sops;
    const term = search.toLowerCase();
    return sops.filter(
      (s) =>
        s.titel.toLowerCase().includes(term) ||
        s.kategorie.toLowerCase().includes(term)
    );
  }, [sops, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Sop[]>();
    for (const sop of filtered) {
      const list = groups.get(sop.kategorie) ?? [];
      list.push(sop);
      groups.set(sop.kategorie, list);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SOP-Bibliothek</h1>
          <p className="text-sm text-muted-foreground">
            {sops.length} Anleitungen
          </p>
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            {search
              ? "Keine SOPs gefunden."
              : "Noch keine SOPs angelegt."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([kategorie, items]) => (
            <div key={kategorie}>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {kategorie}
              </h2>
              <div className="divide-y rounded-lg border bg-card">
                {items.map((sop) => (
                  <Link
                    key={sop.id}
                    href={`/sops/${sop.id}`}
                    className="flex items-center justify-between px-3 py-2.5 text-sm transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-center gap-2.5">
                      <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium">{sop.titel}</span>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(sop.updated_at), {
                        addSuffix: true,
                        locale: de,
                      })}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
