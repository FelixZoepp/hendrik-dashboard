import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { META_STANDARD_TOKEN_ENV, metaConfig } from "@/lib/eingang/logik";
import { metaTokenEnvName, type LeadEingangZeile, type LeadQuelleZeile } from "@/lib/eingang/verarbeitung";
import { Button } from "@/components/ui/button";
import { emailSchalter } from "./aktionen";
import { STATUS_LABEL } from "./anleitung";
import { NeueQuelle, QuelleKarte, type QuelleAnsicht } from "./quelle-karte";

/** Abschnitt „Lead-Eingänge“ auf der Kundenseite im Team-Bereich (nur Team – Seite ruft requireTeam()). */

async function basisUrl(): Promise<string> {
  const fest = process.env.NEXT_PUBLIC_SITE_URL;
  if (fest) return fest.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const zeit = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }).format(new Date(iso))
    : "–";

export async function LeadEingaenge({ companyId }: { companyId: string }) {
  const db = createAdminClient();
  const [qRes, eRes, fRes] = await Promise.all([
    db.from("lead_quellen").select("*").eq("company_id", companyId).order("created_at"),
    db
      .from("lead_eingang")
      .select("id, quelle_id, status, fehler, lead_id, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(20),
    db.from("companies").select("benachrichtigung_email").eq("id", companyId).maybeSingle(),
  ]);

  if (qRes.error) {
    return (
      <section className="fern-card p-6">
        <h2 className="text-base font-semibold">Lead-Eingänge</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Noch nicht eingerichtet: Migration <code>00014_lead_eingang.sql</code> im Supabase-SQL-Editor einspielen.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{qRes.error.message}</p>
      </section>
    );
  }

  const basis = await basisUrl();
  const quellen = (qRes.data ?? []) as LeadQuelleZeile[];
  const eingaenge = (eRes.data ?? []) as Pick<LeadEingangZeile, "id" | "quelle_id" | "status" | "fehler" | "lead_id" | "created_at">[];
  const emailAn = (fRes.data as { benachrichtigung_email?: boolean } | null)?.benachrichtigung_email === true;
  const namen = new Map(quellen.map((q) => [q.id, q.name]));

  const metaUmgebung = {
    url: `${basis}/api/webhooks/meta-leads`,
    verifyToken: !!process.env.META_LEADS_VERIFY_TOKEN,
    appSecret: !!(process.env.META_LEADS_APP_SECRET || process.env.META_APP_SECRET),
  };

  const ansichten: QuelleAnsicht[] = quellen.map((q) => {
    const m = metaConfig(q.config);
    const tokenEnv = metaTokenEnvName(q.config);
    const mapping = q.config?.mapping && typeof q.config.mapping === "object" ? (q.config.mapping as Record<string, string>) : {};
    return {
      id: q.id,
      art: q.art,
      name: q.name,
      aktiv: q.aktiv,
      url: `${basis}/api/webhooks/leads/${q.token}`,
      googleKey: q.art === "google" && typeof q.config?.key === "string" ? q.config.key : null,
      meta:
        q.art === "meta"
          ? {
              ...metaUmgebung,
              pageId: m.pageId ?? "",
              formIds: m.formIds.join(", "),
              tokenEnv: m.tokenEnv ?? "",
              tokenEnvName: tokenEnv,
              tokenVorhanden: !!process.env[tokenEnv],
              standardEnv: META_STANDARD_TOKEN_ENV,
            }
          : null,
      mapping: Object.entries(mapping)
        .map(([k, v]) => `${k} = ${v}`)
        .join("\n"),
      letzterEingang: zeit(q.letzte_eingang_am),
    };
  });

  return (
    <section className="fern-card space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Lead-Eingänge</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Hier kommen die Anfragen für diesen Betrieb an. Jeder Eingang hat eine eigene geheime Adresse.
          </p>
        </div>
        <NeueQuelle companyId={companyId} />
      </div>

      {ansichten.length === 0 ? (
        <p className="rounded-2xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          Noch kein Eingang. Lege oben einen an (z. B. für den Perspective-Funnel).
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {ansichten.map((q) => (
            <QuelleKarte key={q.id} quelle={q} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3">
        <div className="text-sm">
          <p className="font-medium">E-Mail an den Betrieb bei neuem Lead</p>
          <p className="text-xs text-muted-foreground">
            {emailAn ? "An – die Inhaber bekommen eine E-Mail." : "Aus – nur die Glocke im Kundenportal."} Testleads lösen nie eine E-Mail aus.
          </p>
        </div>
        <form action={emailSchalter}>
          <input type="hidden" name="company_id" value={companyId} />
          <input type="hidden" name="an" value={emailAn ? "0" : "1"} />
          <Button type="submit" size="sm" variant={emailAn ? "secondary" : "default"}>
            {emailAn ? "Ausschalten" : "Einschalten"}
          </Button>
        </form>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Letzte Eingänge</h3>
        {eingaenge.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Noch nichts angekommen.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {eingaenge.map((e) => {
              const s = STATUS_LABEL[e.status] ?? { text: e.status, klasse: "bg-muted" };
              return (
                <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
                  <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{zeit(e.created_at)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.klasse}`}>{s.text}</span>
                  <span className="min-w-0 flex-1 break-words text-xs text-muted-foreground">
                    {(e.quelle_id && namen.get(e.quelle_id)) || "–"}
                    {e.fehler ? ` · ${e.fehler}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
