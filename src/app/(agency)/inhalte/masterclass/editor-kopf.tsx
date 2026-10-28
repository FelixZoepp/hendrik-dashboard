import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "inhalte", label: "Inhalte", href: "/inhalte/masterclass" },
  { key: "freischaltung", label: "Freischaltung", href: "/inhalte/masterclass/freischaltung" },
  { key: "fortschritt", label: "Fortschritt", href: "/inhalte/masterclass/fortschritt" },
] as const;

export function EditorKopf({
  aktiv,
  fehler,
  children,
}: {
  aktiv: (typeof TABS)[number]["key"];
  fehler?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="fern-page-title">Masterclass-Editor</h1>
          <p className="text-sm text-muted-foreground">
            Module und Lektionen für die Kunden-Masterclass (Verkaufen &amp; Auftragsfindung). Kunden sehen nur Veröffentlichtes.
          </p>
        </div>
        {children}
      </div>
      <nav className="flex gap-1 overflow-x-auto rounded-full bg-muted p-1 sm:w-fit">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={cn(
              "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors",
              t.key === aktiv ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {fehler && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{fehler}</p>}
    </div>
  );
}

export function StatusPille({ status }: { status: "entwurf" | "veroeffentlicht" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        status === "veroeffentlicht" ? "bg-success/15 text-success" : "bg-warning/20 text-foreground",
      )}
    >
      {status === "veroeffentlicht" ? "Veröffentlicht" : "Entwurf"}
    </span>
  );
}

/** Kleine Hoch/Runter-Knöpfe als Formulare (funktionieren ohne JavaScript). */
export function HochRunter({
  aktion,
  felder,
  erster,
  letzter,
}: {
  aktion: (fd: FormData) => Promise<void>;
  felder: Record<string, string>;
  erster: boolean;
  letzter: boolean;
}) {
  const versteckt = Object.entries(felder).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  return (
    <div className="flex shrink-0 flex-col">
      <form action={aktion}>
        {versteckt}
        <input type="hidden" name="richtung" value="hoch" />
        <button
          type="submit"
          disabled={erster}
          aria-label="Nach oben"
          className="grid h-7 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
      </form>
      <form action={aktion}>
        {versteckt}
        <input type="hidden" name="richtung" value="runter" />
        <button
          type="submit"
          disabled={letzter}
          aria-label="Nach unten"
          className="grid h-7 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
