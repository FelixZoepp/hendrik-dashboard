"use server";

import { revalidatePath } from "next/cache";
import { requireKunde, requireTeam } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { istUuid } from "@/lib/zugriff";
import {
  MAPPING_ZIELE,
  QUELLEN_ARTEN,
  leseGoogle,
  leseMetaLead,
  lesePerspective,
  leseWebhook,
  leseMapping,
  metaConfig,
  metaKonflikt,
  neuerToken,
  testBody,
  type MappingZiel,
  type QuellenArt,
} from "@/lib/eingang/logik";
import { speichereLead, type LeadQuelleZeile } from "@/lib/eingang/verarbeitung";

/** Server-Aktionen für den Abschnitt „Lead-Eingänge“ (Team) und die Glocke (Kunde). */

export interface AktionStatus {
  fehler: string | null;
  meldung: string | null;
}

const OK = (meldung: string): AktionStatus => ({ fehler: null, meldung });
const FEHLER = (fehler: string): AktionStatus => ({ fehler, meldung: null });

const text = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);

async function ladeQuelle(id: string): Promise<LeadQuelleZeile | null> {
  if (!istUuid(id)) return null;
  const { data } = await createAdminClient().from("lead_quellen").select("*").eq("id", id).maybeSingle();
  return (data as LeadQuelleZeile | null) ?? null;
}

const neuLaden = (companyId: string) => revalidatePath(`/kunden/${companyId}`);

/** Fehlertext, wenn eine andere aktive Meta-Quelle dieselbe Seite/Formulare abdeckt */
async function metaKonfliktText(eigeneId: string | null, config: Record<string, unknown>): Promise<string | null> {
  const db = createAdminClient();
  const { data, error } = await db.from("lead_quellen").select("id, company_id, aktiv, config, name").eq("art", "meta").eq("aktiv", true);
  if (error) return `Prüfung fehlgeschlagen: ${error.message}`;
  const andere = (data ?? []) as Array<Pick<LeadQuelleZeile, "id" | "company_id" | "aktiv" | "config" | "name">>;
  const k = metaKonflikt(andere, eigeneId, config);
  if (!k) return null;
  const { data: firma } = await db.from("companies").select("name").eq("id", k.company_id).maybeSingle();
  return `Diese Seite ist schon beim Eingang „${k.name}“ (${firma?.name ?? "andere Firma"}) aktiv. Bitte je Eingang eigene Formular-IDs ohne Überschneidung eintragen oder den anderen Eingang ausschalten.`;
}

/** Meta-Felder aus dem Formular (Seiten-ID, Formular-IDs, optional eigene Token-Variable) */
function metaAusFormular(fd: FormData): { config: Record<string, unknown> } | { fehler: string } {
  const pageId = text(fd, "page_id", 40);
  if (pageId && !/^\d{3,30}$/.test(pageId)) return { fehler: "Die Seiten-ID besteht nur aus Ziffern." };
  const formRoh = text(fd, "form_ids", 2000);
  const formIds = formRoh.split(/[\s,;]+/).filter(Boolean);
  if (formIds.some((f) => !/^\d{3,30}$/.test(f))) return { fehler: "Formular-IDs bestehen nur aus Ziffern (mehrere mit Komma trennen)." };
  const tokenEnv = text(fd, "token_env", 80);
  if (tokenEnv && !/^META_PAGE_TOKEN_[A-Z0-9_]{1,60}$/.test(tokenEnv)) {
    return { fehler: "Eigene Token-Variable muss mit META_PAGE_TOKEN_ beginnen (nur Großbuchstaben, Ziffern, _)." };
  }
  const config: Record<string, unknown> = { page_id: pageId || null, form_ids: formIds };
  if (tokenEnv) config.token_env = tokenEnv;
  return { config };
}

/** Feld-Zuordnung „telefon = kontakt.handy“ (eine pro Zeile) */
function mappingAusText(roh: string): { mapping: Partial<Record<MappingZiel, string>> } | { fehler: string } {
  const mapping: Record<string, string> = {};
  for (const zeile of roh.split(/\n/).map((z) => z.trim()).filter(Boolean)) {
    const [ziel, pfad] = zeile.split(/\s*[=:]\s*/, 2);
    if (!MAPPING_ZIELE.includes(ziel as MappingZiel)) return { fehler: `Unbekanntes Feld „${ziel}“. Erlaubt: ${MAPPING_ZIELE.join(", ")}` };
    if (!pfad) return { fehler: `Zeile „${zeile}“: Pfad fehlt (z. B. telefon = kontakt.handy)` };
    mapping[ziel] = pfad;
  }
  const geprueft = leseMapping(mapping);
  if (Object.keys(geprueft).length !== Object.keys(mapping).length) return { fehler: "Pfade nur mit Buchstaben, Ziffern, _ und Punkten (z. B. daten.kontakt.telefon)." };
  return { mapping: geprueft };
}

export async function quelleAnlegen(_vorher: AktionStatus, fd: FormData): Promise<AktionStatus> {
  await requireTeam();
  const companyId = text(fd, "company_id", 40);
  const art = text(fd, "art", 20) as QuellenArt;
  const name = text(fd, "name", 100);
  if (!istUuid(companyId)) return FEHLER("Firma fehlt.");
  if (!QUELLEN_ARTEN.includes(art)) return FEHLER("Bitte eine Art wählen.");

  let config: Record<string, unknown> = {};
  if (art === "google") config = { key: neuerToken(24) };
  if (art === "meta") {
    const m = metaAusFormular(fd);
    if ("fehler" in m) return FEHLER(m.fehler);
    if (!m.config.page_id) return FEHLER("Für Meta bitte die Seiten-ID (Facebook-Seite) eintragen.");
    const konflikt = await metaKonfliktText(null, m.config);
    if (konflikt) return FEHLER(konflikt);
    config = m.config;
  }

  const db = createAdminClient();
  const { data: firma } = await db.from("companies").select("id").eq("id", companyId).maybeSingle();
  if (!firma) return FEHLER("Firma nicht gefunden.");
  const { error } = await db.from("lead_quellen").insert({ company_id: companyId, art, name: name || STANDARD_NAME[art], token: neuerToken(), config });
  if (error) return FEHLER(`Anlegen fehlgeschlagen: ${error.message}`);
  neuLaden(companyId);
  return OK("Eingang angelegt.");
}

const STANDARD_NAME: Record<QuellenArt, string> = {
  perspective: "Perspective-Funnel",
  meta: "Meta-Leadformular",
  google: "Google-Ads-Formular",
  webhook: "Webhook",
};

export async function quelleAktivSetzen(fd: FormData): Promise<void> {
  await requireTeam();
  const q = await ladeQuelle(text(fd, "id", 40));
  if (!q) return;
  await createAdminClient().from("lead_quellen").update({ aktiv: fd.get("aktiv") === "1" }).eq("id", q.id);
  neuLaden(q.company_id);
}

export async function tokenNeu(fd: FormData): Promise<void> {
  await requireTeam();
  const q = await ladeQuelle(text(fd, "id", 40));
  if (!q) return;
  await createAdminClient().from("lead_quellen").update({ token: neuerToken() }).eq("id", q.id);
  neuLaden(q.company_id);
}

export async function googleKeyNeu(fd: FormData): Promise<void> {
  await requireTeam();
  const q = await ladeQuelle(text(fd, "id", 40));
  if (!q || q.art !== "google") return;
  await createAdminClient().from("lead_quellen").update({ config: { ...q.config, key: neuerToken(24) } }).eq("id", q.id);
  neuLaden(q.company_id);
}

export async function quelleEinstellungen(_vorher: AktionStatus, fd: FormData): Promise<AktionStatus> {
  await requireTeam();
  const q = await ladeQuelle(text(fd, "id", 40));
  if (!q) return FEHLER("Eingang nicht gefunden.");
  const name = text(fd, "name", 100);
  let config = q.config ?? {};
  if (q.art === "meta") {
    const m = metaAusFormular(fd);
    if ("fehler" in m) return FEHLER(m.fehler);
    if (!m.config.page_id) return FEHLER("Die Seiten-ID darf nicht leer sein.");
    const konflikt = await metaKonfliktText(q.id, m.config);
    if (konflikt) return FEHLER(konflikt);
    config = { ...config, ...m.config };
    if (!m.config.token_env) delete config.token_env;
  }
  if (q.art === "webhook") {
    const m = mappingAusText(String(fd.get("mapping") ?? ""));
    if ("fehler" in m) return FEHLER(m.fehler);
    config = { ...config, mapping: m.mapping };
  }
  const { error } = await createAdminClient()
    .from("lead_quellen")
    .update({ name: name || q.name, config })
    .eq("id", q.id);
  if (error) return FEHLER(`Speichern fehlgeschlagen: ${error.message}`);
  neuLaden(q.company_id);
  return OK("Gespeichert.");
}

/** Testlead über dieselbe Logik wie der echte Webhook (als Test markiert, keine E-Mail) */
export async function testleadSenden(_vorher: AktionStatus, fd: FormData): Promise<AktionStatus> {
  await requireTeam();
  const q = await ladeQuelle(text(fd, "id", 40));
  if (!q) return FEHLER("Eingang nicht gefunden.");
  const jetzt = new Date();
  const body = testBody(q.art, jetzt);
  const lead =
    q.art === "perspective"
      ? lesePerspective(body)
      : q.art === "google"
        ? leseGoogle(body).lead
        : q.art === "meta"
          ? leseMetaLead(body, {
              leadgenId: String(body.id),
              pageId: metaConfig(q.config).pageId,
              formId: metaConfig(q.config).formIds[0] ?? null,
              adId: null,
              adgroupId: null,
              campaignId: null,
            })
          : leseWebhook(body, {});
  lead.test = true;
  try {
    const r = await speichereLead(createAdminClient(), q, lead, { ...body, _testlead: true }, jetzt);
    neuLaden(q.company_id);
    if (r.status === "ok") return OK("Testlead angelegt – er steht jetzt in den Leads des Kunden (als Test markiert).");
    return FEHLER(r.fehler ?? `Status: ${r.status}`);
  } catch (err) {
    return FEHLER(err instanceof Error ? err.message : String(err));
  }
}

/** E-Mail an den Betrieb bei neuem Lead (Standard AUS) */
export async function emailSchalter(fd: FormData): Promise<void> {
  await requireTeam();
  const companyId = text(fd, "company_id", 40);
  if (!istUuid(companyId)) return;
  await createAdminClient().from("companies").update({ benachrichtigung_email: fd.get("an") === "1" }).eq("id", companyId);
  neuLaden(companyId);
}

// ---------------------------------------------------------------------------
// Kunde: Glocke
// ---------------------------------------------------------------------------

/** Alle (oder eine) Benachrichtigung der eigenen Firma als gelesen markieren */
export async function benachrichtigungenGelesen(id?: string): Promise<void> {
  const ctx = await requireKunde();
  // „Als Kunde ansehen“: nichts im Namen des Kunden verändern
  if (ctx.impersoniert) return;
  let q = createAdminClient()
    .from("benachrichtigungen")
    .update({ gelesen_am: new Date().toISOString() })
    .eq("company_id", ctx.companyId)
    .is("gelesen_am", null)
    .or(`user_id.is.null,user_id.eq.${ctx.profile.id}`);
  if (id) {
    if (!istUuid(id)) return;
    q = q.eq("id", id);
  }
  await q;
  revalidatePath("/", "layout");
}
