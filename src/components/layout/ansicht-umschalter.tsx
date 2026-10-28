import Link from "next/link";
import { Eye } from "lucide-react";
import { getKontext } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { kundeAnsehen, rolleAnsehen } from "@/lib/ansicht-aktionen";
import { cn } from "@/lib/utils";

/** Name, an dem der Testkunde erkannt wird (siehe Kunden-Liste). */
export const TESTKUNDE_NAME = "Testbetrieb Mustermann (Test)";

const ROLLEN = [
  { wert: "admin", label: "Admin" },
  { wert: "sales", label: "Sales" },
  { wert: "fulfillment", label: "Fulfillment" },
] as const;

/** Nur für echte Admins: Cloud als Admin, Mitarbeiter oder Kunde ansehen. */
export async function AnsichtUmschalter() {
  const ctx = await getKontext();
  if (!ctx || ctx.echteRolle !== "admin") return null;

  const { data: test } = await createAdminClient()
    .from("companies")
    .select("id")
    .eq("name", TESTKUNDE_NAME)
    .maybeSingle();

  const aktiv = ctx.impersoniert ? "kunde" : ctx.rolle;
  const knopf = (an: boolean) =>
    cn(
      "w-full rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
      an ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="rounded-2xl border border-border bg-sidebar-accent/60 p-3">
      <p className="flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <Eye className="size-3.5" /> Ansicht
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {ROLLEN.map((r) => (
          <form key={r.wert} action={rolleAnsehen}>
            <input type="hidden" name="rolle" value={r.wert} />
            <button type="submit" className={knopf(aktiv === r.wert)}>
              {r.label}
            </button>
          </form>
        ))}
        {test ? (
          <form action={kundeAnsehen}>
            <input type="hidden" name="company_id" value={test.id} />
            <button type="submit" className={knopf(aktiv === "kunde")}>
              Kunde
            </button>
          </form>
        ) : (
          <Link href="/kunden" className={cn(knopf(aktiv === "kunde"), "block text-center")}>
            Kunde
          </Link>
        )}
      </div>
    </div>
  );
}
