// Reine Masterclass-Logik (ohne Next-/Supabase-Imports) — von Seiten, Server Actions und
// scripts/test-masterclass.mjs genutzt.
//
// Datenmodell (Migration 00016): Modul = Zeile in public.courses, Lektion = public.lessons.
// Fehlen die neuen Spalten noch (Migration nicht eingespielt), liefern die normalisiere*-Funktionen
// Standardwerte: alles veröffentlicht, Typ Video, keine Anhänge — so wie die Akademie bisher war.

export type Status = "entwurf" | "veroeffentlicht";
export type LektionTyp = "video" | "text";

export interface Anhang {
  name: string;
  /** Externer Link (https://…) */
  url?: string;
  /** Datei im Storage-Bucket „masterclass“ (wird beim Anzeigen signiert) */
  pfad?: string;
}

export interface Zeitmarke {
  sekunden: number;
  titel: string;
}

export interface Modul {
  id: string;
  titel: string;
  beschreibung: string | null;
  /** https-URL oder Pfad im Bucket „masterclass“ */
  bild_url: string | null;
  reihenfolge: number;
  status: Status;
  voraussetzung_course_id: string | null;
}

export interface Lektion {
  id: string;
  course_id: string;
  titel: string;
  beschreibung: string | null;
  kapitel: string | null;
  typ: LektionTyp;
  video_url: string | null;
  content_md: string | null;
  content_html: string | null;
  anhaenge: Anhang[];
  zeitmarken: Zeitmarke[];
  dauer: number | null;
  reihenfolge: number;
  status: Status;
  /** Tage nach Start der Zusammenarbeit (companies.start_datum), 0 = sofort */
  freigeschaltet_ab: number;
}

export interface Aufgabe {
  id: string;
  lesson_id: string;
  titel: string;
  beschreibung: string | null;
  reihenfolge: number;
}

/** Freischaltung je Firma: true = immer frei (auch ohne Voraussetzung), false = gesperrt. Kein Eintrag = Standard. */
export type Freischaltungen = Record<string, boolean>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const zahl = (v: unknown, standard: number): number => (typeof v === "number" && Number.isFinite(v) ? v : standard);

export function normalisiereModul(row: Record<string, unknown>): Modul {
  return {
    id: String(row.id),
    titel: String(row.titel ?? ""),
    beschreibung: str(row.beschreibung),
    bild_url: str(row.bild_url),
    reihenfolge: zahl(row.reihenfolge, 0),
    status: row.status === "entwurf" ? "entwurf" : "veroeffentlicht",
    voraussetzung_course_id: str(row.voraussetzung_course_id),
  };
}

export function normalisiereAnhaenge(v: unknown): Anhang[] {
  if (!Array.isArray(v)) return [];
  const out: Anhang[] = [];
  for (const a of v) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const name = str(o.name);
    const url = str(o.url);
    const pfad = str(o.pfad);
    if (!name) continue;
    if (pfad && istSpeicherPfad(pfad)) out.push({ name, pfad });
    else if (url && sichererLink(url)) out.push({ name, url });
  }
  return out;
}

export function normalisiereLektion(row: Record<string, unknown>): Lektion {
  const zeitmarken = Array.isArray(row.zeitmarken)
    ? (row.zeitmarken as unknown[])
        .filter(
          (z): z is Zeitmarke =>
            !!z && typeof (z as Zeitmarke).sekunden === "number" && typeof (z as Zeitmarke).titel === "string",
        )
        .sort((a, b) => a.sekunden - b.sekunden)
    : [];
  return {
    id: String(row.id),
    course_id: String(row.course_id),
    titel: String(row.titel ?? ""),
    beschreibung: str(row.beschreibung),
    kapitel: str(row.kapitel),
    typ: row.typ === "text" ? "text" : "video",
    video_url: str(row.video_url),
    content_md: str(row.content_md),
    content_html: str(row.content_html),
    anhaenge: normalisiereAnhaenge(row.anhaenge),
    zeitmarken,
    dauer: typeof row.dauer === "number" ? row.dauer : null,
    reihenfolge: zahl(row.reihenfolge, 0),
    status: row.status === "entwurf" ? "entwurf" : "veroeffentlicht",
    freigeschaltet_ab: Math.max(0, zahl(row.freigeschaltet_ab, 0)),
  };
}

export function normalisiereAufgabe(row: Record<string, unknown>): Aufgabe {
  return {
    id: String(row.id),
    lesson_id: String(row.lesson_id),
    titel: String(row.titel ?? ""),
    beschreibung: str(row.beschreibung),
    reihenfolge: zahl(row.reihenfolge, 0),
  };
}

const nachReihenfolge = <T extends { reihenfolge: number; titel: string }>(a: T, b: T) =>
  a.reihenfolge - b.reihenfolge || a.titel.localeCompare(b.titel, "de");

export function sortiereModule(module: Modul[]): Modul[] {
  return [...module].sort(nachReihenfolge);
}

export function lektionenVon(modulId: string, lektionen: Lektion[]): Lektion[] {
  return lektionen.filter((l) => l.course_id === modulId).sort(nachReihenfolge);
}

/** Was Kunden sehen: veröffentlichte Module mit ihren veröffentlichten Lektionen. */
export function sichtbarerKatalog(module: Modul[], lektionen: Lektion[]): { module: Modul[]; lektionen: Lektion[] } {
  const m = sortiereModule(module.filter((x) => x.status === "veroeffentlicht"));
  const ids = new Set(m.map((x) => x.id));
  return { module: m, lektionen: lektionen.filter((l) => l.status === "veroeffentlicht" && ids.has(l.course_id)) };
}

/** Alle Lektionen in Lernreihenfolge (Modul für Modul). */
export function lernreihenfolge(module: Modul[], lektionen: Lektion[]): Lektion[] {
  return sortiereModule(module).flatMap((m) => lektionenVon(m.id, lektionen));
}

/** Lektionen eines Moduls nach Kapitel gruppiert (Reihenfolge bleibt erhalten). */
export function nachKapiteln(lektionen: Lektion[]): { kapitel: string | null; lektionen: Lektion[] }[] {
  const gruppen: { kapitel: string | null; lektionen: Lektion[] }[] = [];
  for (const l of lektionen) {
    const letzte = gruppen[gruppen.length - 1];
    if (letzte && letzte.kapitel === l.kapitel) letzte.lektionen.push(l);
    else gruppen.push({ kapitel: l.kapitel, lektionen: [l] });
  }
  return gruppen;
}

/* ── Fortschritt ─────────────────────────────────────────────── */

export interface Fortschritt {
  erledigt: number;
  gesamt: number;
  prozent: number;
}

export function fortschritt(lektionIds: string[], erledigt: ReadonlySet<string>): Fortschritt {
  const gesamt = lektionIds.length;
  const fertig = lektionIds.filter((id) => erledigt.has(id)).length;
  return { erledigt: fertig, gesamt, prozent: gesamt ? Math.round((fertig / gesamt) * 100) : 0 };
}

export function modulFortschritt(modulId: string, lektionen: Lektion[], erledigt: ReadonlySet<string>): Fortschritt {
  return fortschritt(lektionenVon(modulId, lektionen).map((l) => l.id), erledigt);
}

export interface PersonFortschritt extends Fortschritt {
  user_id: string;
  zuletzt: string | null;
}

/** Fortschritt je Person (nur gezählte Lektionen zählen; Einträge zu Entwürfen/gelöschten fallen weg). */
export function fortschrittJePerson(
  personen: string[],
  eintraege: { user_id: string; lesson_id: string; abgeschlossen_am: string | null }[],
  lektionIds: string[],
): PersonFortschritt[] {
  const gueltig = new Set(lektionIds);
  return personen.map((uid) => {
    const eigene = eintraege.filter((e) => e.user_id === uid && gueltig.has(e.lesson_id));
    const zuletzt = eigene.reduce<string | null>(
      (max, e) => (e.abgeschlossen_am && (!max || e.abgeschlossen_am > max) ? e.abgeschlossen_am : max),
      null,
    );
    return { user_id: uid, ...fortschritt(lektionIds, new Set(eigene.map((e) => e.lesson_id))), zuletzt };
  });
}

/* ── Freischaltung ───────────────────────────────────────────── */

export type SperrGrund = "firma" | "voraussetzung" | "zeit";

export interface Sperre {
  gesperrt: boolean;
  grund: SperrGrund | null;
  /** Kurzer Hinweis für Handwerker */
  hinweis: string | null;
}

const FREI: Sperre = { gesperrt: false, grund: null, hinweis: null };

/**
 * Sperre je Modul:
 * 1. Firma gezielt gesperrt (Freischaltung = false) → gesperrt.
 * 2. Firma gezielt freigeschaltet (true) → frei, auch wenn die Voraussetzung fehlt.
 * 3. Sonst: „erst nach Modul X“ → frei, sobald alle Lektionen von X erledigt sind.
 *    Ist X nicht (mehr) sichtbar oder leer, gilt keine Sperre.
 */
export function modulSperren(
  module: Modul[],
  lektionen: Lektion[],
  erledigt: ReadonlySet<string>,
  freischaltungen: Freischaltungen,
): Map<string, Sperre> {
  const titel = new Map(module.map((m) => [m.id, m.titel]));
  const out = new Map<string, Sperre>();
  for (const m of module) {
    const f = freischaltungen[m.id];
    if (f === false) {
      out.set(m.id, { gesperrt: true, grund: "firma", hinweis: "Wird für dich freigeschaltet" });
      continue;
    }
    if (f === true || !m.voraussetzung_course_id || m.voraussetzung_course_id === m.id) {
      out.set(m.id, FREI);
      continue;
    }
    const vor = m.voraussetzung_course_id;
    const p = modulFortschritt(vor, lektionen, erledigt);
    if (!titel.has(vor) || p.gesamt === 0 || p.erledigt === p.gesamt) {
      out.set(m.id, FREI);
    } else {
      out.set(m.id, {
        gesperrt: true,
        grund: "voraussetzung",
        hinweis: `Erst nach „${titel.get(vor)}“`,
      });
    }
  }
  return out;
}

const TAG_MS = 24 * 60 * 60 * 1000;

/** Tage seit Start (Datum ohne Uhrzeit, lokale Angabe „YYYY-MM-DD“ oder ISO). null = kein Start bekannt. */
export function tageSeit(start: string | null, heute: Date): number | null {
  if (!start) return null;
  const s = new Date(start.length === 10 ? `${start}T00:00:00Z` : start);
  if (Number.isNaN(s.getTime())) return null;
  const a = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const b = Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth(), heute.getUTCDate());
  return Math.floor((b - a) / TAG_MS);
}

/** Sperre einer Lektion: Modul-Sperre, sonst „ab Tag X“ nach Start der Zusammenarbeit. */
export function lektionSperre(lektion: Lektion, modul: Sperre | undefined, start: string | null, heute: Date): Sperre {
  if (modul?.gesperrt) return modul;
  if (lektion.freigeschaltet_ab <= 0) return FREI;
  const tage = tageSeit(start, heute);
  // Ohne bekannten Start nicht sperren (sonst sähe ein neuer Kunde gar nichts)
  if (tage === null || tage >= lektion.freigeschaltet_ab) return FREI;
  const rest = lektion.freigeschaltet_ab - tage;
  return { gesperrt: true, grund: "zeit", hinweis: rest === 1 ? "Ab morgen verfügbar" : `In ${rest} Tagen verfügbar` };
}

/**
 * „Weiter, wo du warst“: nach der zuletzt erledigten Lektion die nächste offene, freie Lektion;
 * sonst die erste offene, freie. null = alles erledigt oder alles gesperrt.
 */
export function weiterLektion(
  geordnet: Lektion[],
  erledigtAm: ReadonlyMap<string, string | null>,
  gesperrt: ReadonlySet<string>,
): Lektion | null {
  const offen = (l: Lektion) => !erledigtAm.has(l.id) && !gesperrt.has(l.id);
  let letzteIdx = -1;
  let letzteZeit = "";
  geordnet.forEach((l, i) => {
    const t = erledigtAm.get(l.id);
    if (t !== undefined && (t ?? "") >= letzteZeit) {
      letzteZeit = t ?? "";
      letzteIdx = i;
    }
  });
  const danach = geordnet.slice(letzteIdx + 1).find(offen);
  return danach ?? geordnet.find(offen) ?? null;
}

/** Vorherige/nächste Lektion in der Lernreihenfolge. */
export function nachbarn(geordnet: Lektion[], id: string): { vorher: Lektion | null; nachher: Lektion | null } {
  const i = geordnet.findIndex((l) => l.id === id);
  if (i === -1) return { vorher: null, nachher: null };
  return { vorher: geordnet[i - 1] ?? null, nachher: geordnet[i + 1] ?? null };
}

/* ── Sortieren (hoch/runter) ─────────────────────────────────── */

/** Neue Reihenfolge 1…n nach Verschieben von `id` um eine Stelle. Unverändert, wenn am Rand. */
export function verschiebe(ids: string[], id: string, richtung: "hoch" | "runter"): { id: string; reihenfolge: number }[] {
  const liste = [...ids];
  const i = liste.indexOf(id);
  const j = richtung === "hoch" ? i - 1 : i + 1;
  if (i !== -1 && j >= 0 && j < liste.length) [liste[i], liste[j]] = [liste[j], liste[i]];
  return liste.map((x, k) => ({ id: x, reihenfolge: k + 1 }));
}

/* ── Video ───────────────────────────────────────────────────── */

export type VideoEinbettung =
  | { art: "iframe"; anbieter: "youtube" | "vimeo" | "loom"; src: string }
  | { art: "datei"; src: string };

/** YouTube/Vimeo/Loom → Einbett-URL (optional ab Sekunde `start`), .mp4/.webm/.mov → <video>. Sonst null. */
export function videoEinbettung(url: string | null | undefined, start = 0): VideoEinbettung | null {
  if (!url) return null;
  const u = url.trim();
  if (!/^https:\/\//i.test(u)) return null;
  const s = Math.max(0, Math.floor(start));
  const yt = u.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i);
  if (yt) {
    return { art: "iframe", anbieter: "youtube", src: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0${s ? `&start=${s}&autoplay=1` : ""}` };
  }
  const vimeo = u.match(/^https:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d+)(?:\/([\da-f]+))?/i);
  if (vimeo) {
    const h = vimeo[2] ? `?h=${vimeo[2]}` : "";
    return { art: "iframe", anbieter: "vimeo", src: `https://player.vimeo.com/video/${vimeo[1]}${h}${s ? `#t=${s}s` : ""}` };
  }
  const loom = u.match(/^https:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([\da-f]{16,})/i);
  if (loom) return { art: "iframe", anbieter: "loom", src: `https://www.loom.com/embed/${loom[1]}${s ? `?t=${s}` : ""}` };
  if (/^https:\/\/[^\s?#]+\.(?:mp4|webm|mov|m4v)(?:[?#]\S*)?$/i.test(u)) {
    return { art: "datei", src: s ? `${u.split("#")[0]}#t=${s}` : u };
  }
  return null;
}

/** 75 → „1:15“, 3725 → „1:02:05“ */
export function formatZeit(sek: number): string {
  const h = Math.floor(sek / 3600);
  const m = Math.floor((sek % 3600) / 60);
  const s = Math.floor(sek % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** „1:15“ / „1:02:05“ / „75“ → Sekunden, sonst null */
export function parseZeit(text: string): number | null {
  const t = text.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Editor-Textfeld „0:00 Einstieg“ (eine Zeile je Marke) → sortierte Zeitmarken. Ungültige Zeilen fallen weg. */
export function parseZeitmarken(text: string): Zeitmarke[] {
  const out: Zeitmarke[] = [];
  for (const zeile of text.split(/\r?\n/)) {
    const m = zeile.trim().match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const sekunden = parseZeit(m[1]);
    const titel = m[2].trim().slice(0, 120);
    if (sekunden !== null && titel) out.push({ sekunden, titel });
  }
  return out.sort((a, b) => a.sekunden - b.sekunden).slice(0, 60);
}

export function zeitmarkenText(marken: Zeitmarke[]): string {
  return marken.map((z) => `${formatZeit(z.sekunden)} ${z.titel}`).join("\n");
}

/* ── Links, Dateien ──────────────────────────────────────────── */

/** Nur http(s), mailto und relative Pfade. */
export function sichererLink(raw: string): boolean {
  const v = raw.trim();
  return /^https?:\/\/[^\s]+$/i.test(v) || /^mailto:[^\s]+$/i.test(v) || /^\/(?!\/)[^\s]*$/.test(v);
}

/** Pfad im Bucket „masterclass“ (keine URL, kein „..“). */
export function istSpeicherPfad(v: string): boolean {
  return /^[\w-]+(?:\/[\w.-]+)+$/.test(v) && !v.includes("..");
}

/** Dateiname für den Storage: Umlaute ersetzen, nur [a-z0-9._-]. */
export function sichererDateiname(name: string): string {
  const ersetzt = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "");
  return (ersetzt || "datei").slice(-80);
}

/* ── HTML ────────────────────────────────────────────────────── */

const ERLAUBT = new Set(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h2", "h3", "blockquote", "a", "hr"]);
const LEER = new Set(["br", "hr"]);

function maskiere(s: string): string {
  return s
    .replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hrefAttribut(raw: string): string | null {
  const v = raw
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x?0*3a;?/gi, ":")
    .replace(/[\u0000-\u001f\u007f\s]+/g, "")
    .trim();
  if (!sichererLink(v)) return null;
  return v.replace(/&/g, "&amp;").replace(/"/g, "%22").replace(/</g, "%3C").replace(/>/g, "%3E");
}

/**
 * Strenger Allowlist-Filter für Lektionstext: nur einfache Formatierungs-Tags ohne Attribute,
 * Links nur mit sicherem href (http/https/mailto/relativ). Skripte, Styles, Event-Handler,
 * unbekannte Tags fallen weg; <script>/<style>/<iframe>-Inhalte werden komplett entfernt.
 */
export function bereinigeHtml(input: string): string {
  const html = input
    .replace(/<(script|style|iframe|object|embed|template|noscript|textarea|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|template|noscript|textarea|svg|math)\b[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const out: string[] = [];
  const offen: string[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let zuletzt = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push(maskiere(html.slice(zuletzt, m.index)));
    zuletzt = m.index + m[0].length;
    const tag = m[1].toLowerCase();
    const schliessend = m[0].startsWith("</");
    if (!ERLAUBT.has(tag)) continue;
    if (schliessend) {
      const idx = offen.lastIndexOf(tag);
      if (idx === -1) continue;
      while (offen.length > idx) out.push(`</${offen.pop()}>`);
      continue;
    }
    if (LEER.has(tag)) {
      out.push(`<${tag}>`);
      continue;
    }
    if (tag === "a") {
      const h = m[2].match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = h ? hrefAttribut(h[1] ?? h[2] ?? h[3] ?? "") : null;
      out.push(href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">` : "<a>");
    } else {
      out.push(`<${tag}>`);
    }
    offen.push(tag);
  }
  out.push(maskiere(html.slice(zuletzt)));
  while (offen.length) out.push(`</${offen.pop()}>`);
  return out.join("").trim();
}

/** Inline-Markdown auf bereits maskiertem Text: [Text](URL), **fett**, *kursiv* / _kursiv_. */
function inline(maskiert: string): string {
  const links: string[] = [];
  let t = maskiert.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, text: string, url: string) => {
    const href = hrefAttribut(url);
    links.push(href ? `<a href="${href}">${text}</a>` : text);
    return `\u0000${links.length - 1}\u0000`;
  });
  t = t
    .replace(/\*\*(?=\S)([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=\S)([^_\n]+?)_(?!\w)/g, "$1<em>$2</em>");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => links[Number(i)] ?? "");
}

/**
 * Einfaches Markdown → sicheres HTML für Lektionstexte.
 * Unterstützt: ## / ### Überschriften, Absätze, Zeilenumbruch, - Liste, 1. Liste, > Zitat, ---,
 * **fett**, *kursiv*, [Link](https://…). Rohes HTML wird als Text angezeigt; das Ergebnis läuft
 * zusätzlich durch bereinigeHtml.
 */
export function markdownZuHtml(md: string): string {
  const zeilen = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let absatz: string[] = [];
  let liste: { typ: "ul" | "ol"; punkte: string[] } | null = null;
  let zitat: string[] = [];

  const absatzEnde = () => {
    if (absatz.length) out.push(`<p>${absatz.map((z) => inline(maskiere(z))).join("<br>")}</p>`);
    absatz = [];
  };
  const listeEnde = () => {
    if (liste) out.push(`<${liste.typ}>${liste.punkte.map((p) => `<li>${inline(maskiere(p))}</li>`).join("")}</${liste.typ}>`);
    liste = null;
  };
  const zitatEnde = () => {
    if (zitat.length) out.push(`<blockquote>${zitat.map((z) => inline(maskiere(z))).join("<br>")}</blockquote>`);
    zitat = [];
  };
  const allesEnde = () => {
    absatzEnde();
    listeEnde();
    zitatEnde();
  };

  for (const roh of zeilen) {
    const z = roh.trimEnd();
    if (!z.trim()) {
      allesEnde();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = z.match(/^\s*(#{1,3})\s+(.+)$/))) {
      allesEnde();
      const tag = m[1].length === 3 ? "h3" : "h2";
      out.push(`<${tag}>${inline(maskiere(m[2].trim()))}</${tag}>`);
    } else if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(z)) {
      allesEnde();
      out.push("<hr>");
    } else if ((m = z.match(/^\s*[-*•]\s+(.+)$/))) {
      absatzEnde();
      zitatEnde();
      if (liste?.typ !== "ul") listeEnde();
      liste = liste ?? { typ: "ul", punkte: [] };
      liste.punkte.push(m[1]);
    } else if ((m = z.match(/^\s*\d+[.)]\s+(.+)$/))) {
      absatzEnde();
      zitatEnde();
      if (liste?.typ !== "ol") listeEnde();
      liste = liste ?? { typ: "ol", punkte: [] };
      liste.punkte.push(m[1]);
    } else if ((m = z.match(/^\s*>\s?(.*)$/))) {
      absatzEnde();
      listeEnde();
      zitat.push(m[1]);
    } else {
      listeEnde();
      zitatEnde();
      absatz.push(z.trim());
    }
  }
  allesEnde();
  return bereinigeHtml(out.join("\n"));
}
