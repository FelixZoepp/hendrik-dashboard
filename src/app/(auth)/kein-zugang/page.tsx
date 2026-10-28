import type { Metadata } from "next";
import { abmelden } from "@/lib/ansicht-aktionen";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Noch kein Zugang" };

export default function KeinZugangPage() {
  return (
    <div className="fern-card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Dein Zugang ist noch nicht fertig</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Dein Konto ist noch keiner Firma zugeordnet. Hoffmann Solutions richtet das für dich ein – melde dich gern bei
        deinem Ansprechpartner.
      </p>
      <form action={abmelden} className="mt-6">
        <Button type="submit" variant="outline">
          Abmelden
        </Button>
      </form>
    </div>
  );
}
