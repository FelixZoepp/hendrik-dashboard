import type { SupabaseClient } from "@supabase/supabase-js";
import type { KundenKontext } from "@/lib/kontext";
import {
  type Anhang,
  type Aufgabe,
  type Freischaltungen,
  type Lektion,
  type Modul,
  type Sperre,
  istSpeicherPfad,
  lektionSperre,
  lernreihenfolge,
  modulSperren,
  normalisiereAufgabe,
  normalisiereLektion,
  normalisiereModul,
  sichtbarerKatalog,
} from "./logik";

/** Storage-Bucket für Anhänge und Modulbilder (Migration 00016). */
export const MASTERCLASS_BUCKET = "masterclass";
const LINK_GUELTIG_SEKUNDEN = 60 * 60;

type Db = SupabaseClient;

/** Alle Module + Lektionen (auch Entwürfe). select("*"): läuft auch vor Migration 00016. */
export async function ladeKatalog(db: Db): Promise<{ module: Modul[]; lektionen: Lektion[] }> {
  const [m, l] = await Promise.all([
    db.from("courses").select("*").order("reihenfolge"),
    db.from("lessons").select("*").order("reihenfolge"),
  ]);
  return {
    module: ((m.data ?? []) as Record<string, unknown>[]).map(normalisiereModul),
    lektionen: ((l.data ?? []) as Record<string, unknown>[]).map(normalisiereLektion),
  };
}

export async function ladeAufgaben(db: Db, lessonIds: string[]): Promise<Aufgabe[]> {
  if (!lessonIds.length) return [];
  const { data, error } = await db.from("lesson_tasks").select("*").in("lesson_id", lessonIds).order("reihenfolge");
  if (error) return []; // Tabelle fehlt (Migration noch nicht eingespielt)
  return ((data ?? []) as Record<string, unknown>[]).map(normalisiereAufgabe);
}

export async function ladeFreischaltungen(db: Db, companyId: string): Promise<Freischaltungen> {
  const { data, error } = await db
    .from("masterclass_freischaltungen")
    .select("course_id, freigeschaltet")
    .eq("company_id", companyId);
  if (error) return {};
  const out: Freischaltungen = {};
  for (const r of (data ?? []) as { course_id: string; freigeschaltet: boolean }[]) out[r.course_id] = r.freigeschaltet;
  return out;
}

/** Start der Zusammenarbeit (für „ab Tag X“): start_datum, sonst Anlagedatum der Firma. */
export async function ladeStart(db: Db, companyId: string): Promise<string | null> {
  const { data } = await db.from("companies").select("start_datum, created_at").eq("id", companyId).maybeSingle();
  const f = data as { start_datum: string | null; created_at: string | null } | null;
  return f?.start_datum ?? f?.created_at ?? null;
}

/** Personen-IDs einer Firma (für Fortschritt, solange lesson_progress.company_id fehlt). */
async function personenDerFirma(db: Db, companyId: string): Promise<string[]> {
  const { data } = await db.from("profiles").select("id").eq("company_id", companyId);
  return ((data ?? []) as { id: string }[]).map((p) => p.id);
}

/**
 * Erledigte Lektionen (lesson_id → abgeschlossen_am).
 * Kunde: eigener Fortschritt. „Als Kunde ansehen“: Fortschritt der ganzen Firma (nur lesen).
 */
export async function ladeErledigt(db: Db, ctx: KundenKontext): Promise<Map<string, string | null>> {
  let zeilen: { lesson_id: string; abgeschlossen_am: string | null }[] = [];
  if (ctx.impersoniert) {
    const personen = await personenDerFirma(db, ctx.companyId);
    if (personen.length) {
      const { data } = await db.from("lesson_progress").select("lesson_id, abgeschlossen_am").in("user_id", personen);
      zeilen = (data ?? []) as typeof zeilen;
    }
  } else {
    const { data } = await db.from("lesson_progress").select("lesson_id, abgeschlossen_am").eq("user_id", ctx.profile.id);
    zeilen = (data ?? []) as typeof zeilen;
  }
  const out = new Map<string, string | null>();
  for (const z of zeilen) {
    const alt = out.get(z.lesson_id);
    if (alt === undefined || (z.abgeschlossen_am ?? "") > (alt ?? "")) out.set(z.lesson_id, z.abgeschlossen_am);
  }
  return out;
}

export async function ladeErledigteAufgaben(db: Db, ctx: KundenKontext, taskIds: string[]): Promise<Set<string>> {
  if (!taskIds.length) return new Set();
  let q = db.from("lesson_task_progress").select("task_id").in("task_id", taskIds);
  if (ctx.impersoniert) {
    const personen = await personenDerFirma(db, ctx.companyId);
    if (!personen.length) return new Set();
    q = q.in("user_id", personen);
  } else {
    q = q.eq("user_id", ctx.profile.id);
  }
  const { data, error } = await q;
  if (error) return new Set();
  return new Set(((data ?? []) as { task_id: string }[]).map((r) => r.task_id));
}

export interface KundenStand {
  module: Modul[];
  lektionen: Lektion[];
  /** Lernreihenfolge aller sichtbaren Lektionen */
  geordnet: Lektion[];
  erledigtAm: Map<string, string | null>;
  erledigt: Set<string>;
  modulSperre: Map<string, Sperre>;
  lektionSperre: Map<string, Sperre>;
}

/** Was ein Handwerksbetrieb in der Masterclass sieht — inkl. Sperren. */
export async function ladeKundenStand(db: Db, ctx: KundenKontext, heute = new Date()): Promise<KundenStand> {
  const [katalog, erledigtAm, freischaltungen, start] = await Promise.all([
    ladeKatalog(db),
    ladeErledigt(db, ctx),
    ladeFreischaltungen(db, ctx.companyId),
    ladeStart(db, ctx.companyId),
  ]);
  const { module, lektionen } = sichtbarerKatalog(katalog.module, katalog.lektionen);
  const erledigt = new Set(erledigtAm.keys());
  const mSperre = modulSperren(module, lektionen, erledigt, freischaltungen);
  const lSperre = new Map<string, Sperre>();
  for (const l of lektionen) lSperre.set(l.id, lektionSperre(l, mSperre.get(l.course_id), start, heute));
  return {
    module,
    lektionen,
    geordnet: lernreihenfolge(module, lektionen),
    erledigtAm,
    erledigt,
    modulSperre: mSperre,
    lektionSperre: lSperre,
  };
}

export interface AnhangLink {
  name: string;
  href: string;
  datei: boolean;
}

/** Anhänge mit abrufbaren Links (Storage-Dateien als signierte Links, 1 Stunde gültig). */
export async function anhangLinks(db: Db, anhaenge: Anhang[]): Promise<AnhangLink[]> {
  const pfade = anhaenge.map((a) => a.pfad).filter((p): p is string => !!p);
  const signiert = new Map<string, string>();
  if (pfade.length) {
    const { data } = await db.storage.from(MASTERCLASS_BUCKET).createSignedUrls(pfade, LINK_GUELTIG_SEKUNDEN, { download: true });
    for (const s of data ?? []) if (s.path && s.signedUrl) signiert.set(s.path, s.signedUrl);
  }
  const out: AnhangLink[] = [];
  for (const a of anhaenge) {
    if (a.pfad) {
      const href = signiert.get(a.pfad);
      if (href) out.push({ name: a.name, href, datei: true });
    } else if (a.url) {
      out.push({ name: a.name, href: a.url, datei: false });
    }
  }
  return out;
}

/** Modulbilder: https-URL direkt, Storage-Pfad signiert. */
export async function bildLinks(db: Db, module: Modul[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pfade: string[] = [];
  for (const m of module) {
    if (!m.bild_url) continue;
    if (/^https:\/\//i.test(m.bild_url)) out.set(m.id, m.bild_url);
    else if (istSpeicherPfad(m.bild_url)) pfade.push(m.bild_url);
  }
  if (pfade.length) {
    const { data } = await db.storage.from(MASTERCLASS_BUCKET).createSignedUrls(pfade, LINK_GUELTIG_SEKUNDEN);
    const signiert = new Map((data ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
    for (const m of module) if (m.bild_url && signiert.has(m.bild_url)) out.set(m.id, signiert.get(m.bild_url)!);
  }
  return out;
}
