"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTeam } from "@/lib/kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import { fehlendeSpalte } from "@/lib/zugaenge";
import { istUuid } from "@/lib/zugriff";
import { MASTERCLASS_BUCKET } from "@/lib/masterclass/daten";
import {
  type Anhang,
  istSpeicherPfad,
  markdownZuHtml,
  normalisiereAnhaenge,
  parseZeitmarken,
  sichererDateiname,
  sichererLink,
  verschiebe,
  videoEinbettung,
} from "@/lib/masterclass/logik";

export interface EditorStatus {
  fehler: string | null;
  gespeichert: boolean;
}

const MIGRATION_FEHLT = "Die Datenbank kennt die Masterclass-Felder noch nicht (Migration 00016 einspielen).";

const text = (fd: FormData, k: string, max = 2000): string | null => {
  const v = String(fd.get(k) ?? "").trim();
  return v ? v.slice(0, max) : null;
};

/** Fehler als Hinweis auf der Seite (geworfene Fehler zeigt Next in Produktion nur anonym). */
function fehlerZu(pfad: string, meldung: string): never {
  redirect(`${pfad}${pfad.includes("?") ? "&" : "?"}fehler=${encodeURIComponent(meldung)}`);
}

function neuLaden() {
  revalidatePath("/inhalte/masterclass", "layout");
  revalidatePath("/akademie", "layout");
}

function fehlerText(err: { code?: string; message?: string } | null): string {
  if (fehlendeSpalte(err) || err?.code === "42P01" || err?.code === "PGRST205") return MIGRATION_FEHLT;
  return `Speichern fehlgeschlagen: ${err?.message ?? "unbekannt"}`;
}

async function naechsteReihenfolge(tabelle: string, filter?: [string, string]): Promise<number> {
  let q = createAdminClient().from(tabelle).select("reihenfolge").order("reihenfolge", { ascending: false }).limit(1);
  if (filter) q = q.eq(filter[0], filter[1]);
  const { data } = await q;
  return (((data ?? [])[0] as { reihenfolge?: number } | undefined)?.reihenfolge ?? 0) + 1;
}

async function verschiebeIn(tabelle: string, id: string, richtung: "hoch" | "runter", filter?: [string, string]) {
  const db = createAdminClient();
  let q = db.from(tabelle).select("id, reihenfolge, titel").order("reihenfolge").order("titel");
  if (filter) q = q.eq(filter[0], filter[1]);
  const { data } = await q;
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const alt = new Map(((data ?? []) as { id: string; reihenfolge: number }[]).map((r) => [r.id, r.reihenfolge]));
  for (const e of verschiebe(ids, id, richtung)) {
    if (alt.get(e.id) !== e.reihenfolge) await db.from(tabelle).update({ reihenfolge: e.reihenfolge }).eq("id", e.id);
  }
}

const richtungAus = (fd: FormData) => (fd.get("richtung") === "hoch" ? "hoch" : "runter");

/* ── Module ──────────────────────────────────────────────────── */

export async function modulAnlegen(formData: FormData) {
  await requireTeam();
  const titel = text(formData, "titel", 200);
  if (!titel) return;
  const db = createAdminClient();
  const reihenfolge = await naechsteReihenfolge("courses");
  // Vor der Migration gibt es keinen Status → Insert schlägt fehl (Modul wäre sonst sofort sichtbar)
  const res = await db.from("courses").insert({ titel, reihenfolge, status: "entwurf" }).select("id").single();
  if (res.error || !res.data) fehlerZu("/inhalte/masterclass", fehlerText(res.error));
  neuLaden();
  redirect(`/inhalte/masterclass/modul/${(res.data as { id: string }).id}`);
}

export async function modulSpeichern(_vorher: EditorStatus, formData: FormData): Promise<EditorStatus> {
  await requireTeam();
  const id = String(formData.get("id") ?? "");
  if (!istUuid(id)) return { fehler: "Modul nicht gefunden.", gespeichert: false };
  const titel = text(formData, "titel", 200);
  if (!titel) return { fehler: "Bitte einen Titel eingeben.", gespeichert: false };
  const bild = text(formData, "bild_url", 1000);
  if (bild && !/^https:\/\/\S+$/i.test(bild) && !istSpeicherPfad(bild)) {
    return { fehler: "Bild: bitte eine https://-Adresse oder ein Bild hochladen.", gespeichert: false };
  }
  const vor = String(formData.get("voraussetzung_course_id") ?? "");
  const status = formData.get("status") === "veroeffentlicht" ? "veroeffentlicht" : "entwurf";

  const { error } = await createAdminClient()
    .from("courses")
    .update({
      titel,
      beschreibung: text(formData, "beschreibung"),
      bild_url: bild,
      status,
      voraussetzung_course_id: istUuid(vor) && vor !== id ? vor : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { fehler: fehlerText(error), gespeichert: false };
  neuLaden();
  return { fehler: null, gespeichert: true };
}

export async function modulVerschieben(formData: FormData) {
  await requireTeam();
  const id = String(formData.get("id") ?? "");
  if (!istUuid(id)) return;
  await verschiebeIn("courses", id, richtungAus(formData));
  neuLaden();
}

/** Nur leere Module (ohne Lektionen) — schützt vor versehentlichem Löschen von Fortschritt. */
export async function modulLoeschen(formData: FormData) {
  await requireTeam();
  const id = String(formData.get("id") ?? "");
  if (!istUuid(id)) return;
  const db = createAdminClient();
  const { count } = await db.from("lessons").select("id", { count: "exact", head: true }).eq("course_id", id);
  if ((count ?? 0) > 0) fehlerZu(`/inhalte/masterclass/modul/${id}`, "Erst alle Lektionen des Moduls löschen.");
  await db.from("courses").delete().eq("id", id);
  neuLaden();
  redirect("/inhalte/masterclass");
}

export async function bildUploadVorbereiten(courseId: string, dateiname: string) {
  await requireTeam();
  if (!istUuid(courseId)) return { fehler: "Modul nicht gefunden." } as const;
  return signierterUpload(`module/${courseId}/${Date.now()}-${sichererDateiname(dateiname)}`);
}

/* ── Lektionen ───────────────────────────────────────────────── */

export async function lektionAnlegen(formData: FormData) {
  await requireTeam();
  const courseId = String(formData.get("course_id") ?? "");
  const titel = text(formData, "titel", 200);
  if (!istUuid(courseId) || !titel) return;
  const db = createAdminClient();
  const reihenfolge = await naechsteReihenfolge("lessons", ["course_id", courseId]);
  const res = await db
    .from("lessons")
    .insert({ course_id: courseId, titel, reihenfolge, status: "entwurf", typ: "video" })
    .select("id")
    .single();
  if (res.error || !res.data) fehlerZu(`/inhalte/masterclass/modul/${courseId}`, fehlerText(res.error));
  neuLaden();
  redirect(`/inhalte/masterclass/lektion/${(res.data as { id: string }).id}`);
}

export async function lektionSpeichern(_vorher: EditorStatus, formData: FormData): Promise<EditorStatus> {
  await requireTeam();
  const id = String(formData.get("id") ?? "");
  if (!istUuid(id)) return { fehler: "Lektion nicht gefunden.", gespeichert: false };
  const titel = text(formData, "titel", 200);
  if (!titel) return { fehler: "Bitte einen Titel eingeben.", gespeichert: false };
  const courseId = String(formData.get("course_id") ?? "");
  if (!istUuid(courseId)) return { fehler: "Bitte ein Modul wählen.", gespeichert: false };

  const video = text(formData, "video_url", 1000);
  if (video && !videoEinbettung(video)) {
    return {
      fehler: "Video-Link nicht erkannt. Möglich: YouTube, Vimeo, Loom oder eine https-Adresse auf .mp4/.webm/.mov.",
      gespeichert: false,
    };
  }
  const dauerRoh = text(formData, "dauer", 5);
  const dauer = dauerRoh === null ? null : Math.round(Number(dauerRoh.replace(",", ".")));
  if (dauer !== null && (!Number.isFinite(dauer) || dauer < 0 || dauer > 600)) {
    return { fehler: "Dauer bitte in Minuten (0–600).", gespeichert: false };
  }
  const abTag = Math.round(Number(text(formData, "freigeschaltet_ab", 4) ?? "0"));
  const md = String(formData.get("content_md") ?? "").slice(0, 100_000);

  const { error } = await createAdminClient()
    .from("lessons")
    .update({
      titel,
      course_id: courseId,
      beschreibung: text(formData, "beschreibung"),
      kapitel: text(formData, "kapitel", 120),
      typ: formData.get("typ") === "text" ? "text" : "video",
      video_url: video,
      dauer,
      freigeschaltet_ab: Number.isFinite(abTag) && abTag > 0 ? Math.min(abTag, 365) : 0,
      content_md: md.trim() ? md : null,
      content_html: md.trim() ? markdownZuHtml(md) : null,
      zeitmarken: parseZeitmarken(String(formData.get("zeitmarken") ?? "")),
      status: formData.get("status") === "veroeffentlicht" ? "veroeffentlicht" : "entwurf",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { fehler: fehlerText(error), gespeichert: false };
  neuLaden();
  return { fehler: null, gespeichert: true };
}

export async function lektionVerschieben(formData: FormData) {
  await requireTeam();
  const id = String(formData.get("id") ?? "");
  const courseId = String(formData.get("course_id") ?? "");
  if (!istUuid(id) || !istUuid(courseId)) return;
  await verschiebeIn("lessons", id, richtungAus(formData), ["course_id", courseId]);
  neuLaden();
}

/** Nur Entwürfe löschen (veröffentlichte Lektionen haben ggf. Kunden-Fortschritt). */
export async function lektionLoeschen(formData: FormData) {
  await requireTeam();
  const id = String(formData.get("id") ?? "");
  if (!istUuid(id)) return;
  const db = createAdminClient();
  const { data } = await db.from("lessons").select("*").eq("id", id).maybeSingle();
  const zeile = data as { course_id: string; status?: string; anhaenge?: unknown } | null;
  if (!zeile) return;
  if (zeile.status !== "entwurf") {
    fehlerZu(`/inhalte/masterclass/lektion/${id}`, "Nur Entwürfe können gelöscht werden. Erst auf „Entwurf“ stellen und speichern.");
  }
  const pfade = normalisiereAnhaenge(zeile.anhaenge).map((a) => a.pfad).filter((p): p is string => !!p);
  await db.from("lessons").delete().eq("id", id);
  if (pfade.length) await db.storage.from(MASTERCLASS_BUCKET).remove(pfade);
  neuLaden();
  redirect(`/inhalte/masterclass/modul/${zeile.course_id}`);
}

/* ── Anhänge ─────────────────────────────────────────────────── */

async function signierterUpload(pfad: string) {
  const { data, error } = await createAdminClient().storage.from(MASTERCLASS_BUCKET).createSignedUploadUrl(pfad);
  if (error || !data) {
    return { fehler: `Upload nicht möglich (Bucket „${MASTERCLASS_BUCKET}“ angelegt?): ${error?.message ?? "unbekannt"}` } as const;
  }
  return { pfad: data.path, token: data.token } as const;
}

export async function anhangUploadVorbereiten(lessonId: string, dateiname: string) {
  await requireTeam();
  if (!istUuid(lessonId)) return { fehler: "Lektion nicht gefunden." } as const;
  return signierterUpload(`lektionen/${lessonId}/${Date.now()}-${sichererDateiname(dateiname)}`);
}

/** Speichert die komplette Anhang-Liste; entfernte Dateien werden aus dem Storage gelöscht. */
export async function anhaengeSpeichern(lessonId: string, liste: Anhang[]): Promise<EditorStatus> {
  await requireTeam();
  if (!istUuid(lessonId)) return { fehler: "Lektion nicht gefunden.", gespeichert: false };
  const neu = normalisiereAnhaenge(
    (Array.isArray(liste) ? liste : []).slice(0, 30).map((a) => ({
      name: String(a?.name ?? "").trim().slice(0, 160),
      url: a?.url && sichererLink(a.url) && /^https?:\/\//i.test(a.url) ? a.url.trim() : undefined,
      pfad: a?.pfad && a.pfad.startsWith(`lektionen/${lessonId}/`) ? a.pfad : undefined,
    })),
  );
  const db = createAdminClient();
  const { data } = await db.from("lessons").select("*").eq("id", lessonId).maybeSingle();
  if (!data) return { fehler: "Lektion nicht gefunden.", gespeichert: false };
  const alt = normalisiereAnhaenge((data as { anhaenge?: unknown }).anhaenge);
  const { error } = await db.from("lessons").update({ anhaenge: neu, updated_at: new Date().toISOString() }).eq("id", lessonId);
  if (error) return { fehler: fehlerText(error), gespeichert: false };
  const behalten = new Set(neu.map((a) => a.pfad).filter(Boolean));
  const weg = alt.map((a) => a.pfad).filter((p): p is string => !!p && !behalten.has(p));
  if (weg.length) await db.storage.from(MASTERCLASS_BUCKET).remove(weg);
  neuLaden();
  return { fehler: null, gespeichert: true };
}

/* ── Aufgaben ────────────────────────────────────────────────── */

export async function aufgabeSpeichern(formData: FormData) {
  await requireTeam();
  const lessonId = String(formData.get("lesson_id") ?? "");
  const id = String(formData.get("id") ?? "");
  const titel = text(formData, "titel", 300);
  if (!istUuid(lessonId) || !titel) return;
  const db = createAdminClient();
  const werte = { titel, beschreibung: text(formData, "beschreibung", 1000) };
  const { error } = istUuid(id)
    ? await db.from("lesson_tasks").update(werte).eq("id", id).eq("lesson_id", lessonId)
    : await db
        .from("lesson_tasks")
        .insert({ ...werte, lesson_id: lessonId, reihenfolge: await naechsteReihenfolge("lesson_tasks", ["lesson_id", lessonId]) });
  if (error) fehlerZu(`/inhalte/masterclass/lektion/${lessonId}`, fehlerText(error));
  neuLaden();
}

export async function aufgabeLoeschen(formData: FormData) {
  await requireTeam();
  const id = String(formData.get("id") ?? "");
  if (!istUuid(id)) return;
  await createAdminClient().from("lesson_tasks").delete().eq("id", id);
  neuLaden();
}

export async function aufgabeVerschieben(formData: FormData) {
  await requireTeam();
  const id = String(formData.get("id") ?? "");
  const lessonId = String(formData.get("lesson_id") ?? "");
  if (!istUuid(id) || !istUuid(lessonId)) return;
  await verschiebeIn("lesson_tasks", id, richtungAus(formData), ["lesson_id", lessonId]);
  neuLaden();
}

/* ── Freischaltung je Firma ──────────────────────────────────── */

export async function freischaltungSetzen(formData: FormData) {
  const ctx = await requireTeam();
  const companyId = String(formData.get("company_id") ?? "");
  const courseId = String(formData.get("course_id") ?? "");
  const wert = String(formData.get("wert") ?? "standard");
  if (!istUuid(companyId) || !istUuid(courseId)) return;
  const db = createAdminClient();
  const { error } =
    wert === "frei" || wert === "gesperrt"
      ? await db.from("masterclass_freischaltungen").upsert(
          {
            company_id: companyId,
            course_id: courseId,
            freigeschaltet: wert === "frei",
            geaendert_von: ctx.profile.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "company_id,course_id" },
        )
      : await db.from("masterclass_freischaltungen").delete().eq("company_id", companyId).eq("course_id", courseId);
  if (error) fehlerZu(`/inhalte/masterclass/freischaltung?firma=${companyId}`, fehlerText(error));
  neuLaden();
}
