import Link from "next/link";
import { CheckCircle2, ChevronDown, Circle, Hourglass, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OnboardingSchritt, OnboardingStand } from "@/lib/onboarding/logik";

function Balken({ prozent }: { prozent: number }) {
  return (
    <div className="h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={prozent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${prozent}%` }} />
    </div>
  );
}

function SchrittZeile({ s, mitKnopf }: { s: OnboardingSchritt; mitKnopf: boolean }) {
  const Icon = s.erledigt ? CheckCircle2 : s.einrichtung ? Hourglass : Circle;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <Icon className={cn("size-6 shrink-0", s.erledigt ? "text-success" : "text-muted-foreground/60")} aria-hidden />
      <div className="min-w-[10rem] flex-1">
        <p className={cn("text-base font-semibold", s.erledigt && "text-muted-foreground line-through decoration-1")}>{s.titel}</p>
        <p className="text-sm text-muted-foreground">{s.hinweis}</p>
      </div>
      {mitKnopf && !s.erledigt && s.href && s.knopf && (
        <Link
          href={s.href}
          className="ml-9 inline-flex h-11 shrink-0 items-center sm:ml-0 justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 active:translate-y-px"
        >
          {s.knopf}
        </Link>
      )}
    </li>
  );
}

/** Kundenportal (/dashboard): Checkliste mit Knöpfen. Alles erledigt → klappt ein. */
export function OnboardingKarte({ stand }: { stand: OnboardingStand }) {
  if (stand.fertig) {
    return (
      <details className="fern-card group p-5">
        <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
          <CheckCircle2 className="size-6 text-success" aria-hidden />
          <span className="flex-1 text-base font-semibold">Dein Start ist geschafft – alles eingerichtet.</span>
          <ChevronDown className="size-5 text-muted-foreground transition group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="mt-2 divide-y">
          {stand.schritte.map((s) => (
            <SchrittZeile key={s.id} s={s} mitKnopf={false} />
          ))}
        </ul>
      </details>
    );
  }

  return (
    <section className="fern-card space-y-4 border-2 border-primary/20 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Rocket className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold">Dein Start in der Cloud</h2>
          <p className="text-sm text-muted-foreground">
            {stand.erledigt} von {stand.gesamt} erledigt
            {stand.naechster ? ` · Als Nächstes: ${stand.naechster.titel}` : ""}
          </p>
        </div>
        <span className="text-2xl font-bold tabular-nums text-primary">{stand.prozent} %</span>
      </div>
      <Balken prozent={stand.prozent} />
      <ul className="divide-y">
        {stand.schritte.map((s) => (
          <SchrittZeile key={s.id} s={s} mitKnopf />
        ))}
      </ul>
    </section>
  );
}

/** Team (/kunden/[id]): gleicher Stand, ohne Knöpfe – damit man sieht, wo der Kunde hängt. */
export function OnboardingTeamAbschnitt({ stand }: { stand: OnboardingStand }) {
  return (
    <section className="fern-card space-y-3 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Onboarding</h2>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-sm font-bold",
            stand.fertig ? "bg-success text-success-foreground" : "bg-primary/10 text-primary",
          )}
        >
          {stand.erledigt}/{stand.gesamt} erledigt
        </span>
      </div>
      <Balken prozent={stand.prozent} />
      {stand.naechster && <p className="text-sm text-muted-foreground">Hängt bei: <span className="font-semibold text-foreground">{stand.naechster.titel}</span></p>}
      <ul className="divide-y">
        {stand.schritte.map((s) => (
          <SchrittZeile key={s.id} s={s} mitKnopf={false} />
        ))}
      </ul>
    </section>
  );
}
