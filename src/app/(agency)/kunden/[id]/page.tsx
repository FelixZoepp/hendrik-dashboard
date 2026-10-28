import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTeam } from "@/lib/kontext";
import { ansichtStarten } from "@/lib/ansicht-aktionen";
import { istUuid } from "@/lib/zugriff";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ZugangAnlegen } from "@/components/zugaenge/zugang-anlegen";
import { LeadEingaenge } from "@/components/eingang/lead-eingaenge";
import type { Company, Profile } from "@/lib/types/database";
import { FirmaFormular } from "../firma-formular";
import { kundenZugangAktiv, kundenZugangAnlegen } from "../actions";

export const metadata: Metadata = { title: "Kunde" };
export const dynamic = "force-dynamic";

const KUNDEN_ROLLEN = [
  { value: "client_owner", label: "Inhaber (sieht alles)" },
  { value: "client_member", label: "Mitarbeiter" },
];

const ROLLEN_LABEL: Record<string, string> = { client_owner: "Inhaber", client_member: "Mitarbeiter" };

export default async function KundeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fehler?: string }>;
}) {
  await requireTeam();
  const { id } = await params;
  const { fehler } = await searchParams;
  if (!istUuid(id)) notFound();

  const db = createAdminClient();
  const [firmaRes, zugaengeRes] = await Promise.all([
    db.from("companies").select("*").eq("id", id).maybeSingle(),
    db.from("profiles").select("*").eq("company_id", id).order("full_name"),
  ]);
  if (!firmaRes.data) notFound();
  const firma = firmaRes.data as Company;
  const zugaenge = (zugaengeRes.data ?? []) as Profile[];

  return (
    <div className="space-y-6">
      <Link href="/kunden" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Alle Kunden
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="fern-page-title">{firma.name}</h1>
        <form action={ansichtStarten}>
          <input type="hidden" name="company_id" value={firma.id} />
          <Button type="submit" size="sm" variant="secondary">
            <Eye />
            Als Kunde ansehen
          </Button>
        </form>
      </div>

      {fehler && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{fehler}</p>}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="fern-card p-6">
          <h2 className="text-base font-semibold">Stammdaten</h2>
          <div className="mt-4">
            <FirmaFormular firma={firma} />
          </div>
        </section>

        <section className="fern-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Zugänge zur Cloud</h2>
            <ZugangAnlegen
              aktion={kundenZugangAnlegen}
              rollen={KUNDEN_ROLLEN}
              companyId={firma.id}
              titel={`Kundenzugang für ${firma.name}`}
              knopf="Zugang anlegen"
            />
          </div>
          {zugaenge.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Noch keine Zugänge.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {zugaenge.map((z) => (
                <li key={z.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className={z.active ? "truncate text-sm font-medium" : "truncate text-sm font-medium text-muted-foreground line-through"}>
                      {z.full_name || "Ohne Namen"}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <Badge variant="secondary">{ROLLEN_LABEL[z.role] ?? z.role}</Badge>
                      {z.email && <span className="truncate text-xs text-muted-foreground">{z.email}</span>}
                    </div>
                  </div>
                  <form action={kundenZugangAktiv}>
                    <input type="hidden" name="user_id" value={z.id} />
                    <input type="hidden" name="company_id" value={firma.id} />
                    <input type="hidden" name="aktiv" value={z.active ? "0" : "1"} />
                    <Button type="submit" size="xs" variant={z.active ? "ghost" : "secondary"}>
                      {z.active ? "Sperren" : "Entsperren"}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Neuer Link für jemanden, der schon einen Zugang hat (Passwort vergessen): einfach „Zugang anlegen“ mit
            derselben E-Mail.
          </p>
        </section>
      </div>

      <LeadEingaenge companyId={firma.id} />
    </div>
  );
}
