import type { SupabaseClient } from "@supabase/supabase-js";
import { closeApi, closeUserName, type CloseUser } from "@/lib/integrations/close";
import { artAusCalendly, berlinTeile, berlinZeitpunkt, formatDatum } from "@/lib/whatsapp/logik";
import { meldeSlack } from "@/lib/whatsapp/slack";

/**
 * Sales-Auswertung für Slack (#03-sales): Mo–Fr täglich um 19:00 der Tag, freitags zusätzlich die Woche.
 * Anwahlen (Close-Calls), Gesprächsprotokolle (Cold Call/Setting/Closing + Ergebnisse) und
 * WhatsApp-Terminbestätigungen. Wird vom minütlichen WhatsApp-Cron angestoßen (einmal pro Tag).
 */

export const BERICHT_STUNDE = 19;
const BERICHT_KEY = "sales_bericht_tag";

const PROTOKOLL = {
  coldCall: "actitype_6Ni7VfN6jGxhWfQEYLkEdK",
  setting: "actitype_41UXYctoK8pqnPD2TvTGoO",
  closing: "actitype_71sdCTlSLsK8bWiC802Bn8",
} as const;

const ERGEBNIS_FELD = {
  [PROTOKOLL.coldCall]: "custom.cf_rYzdqWeplRWv7FFbrhgaXOhKSUxhYgopFVpUmLHFruf",
  [PROTOKOLL.setting]: "custom.cf_6Kt9RVMkQiuDOXBiiTRrKg8DTwvoQn8EEBCXmaTykGZ",
  [PROTOKOLL.closing]: "custom.cf_9vkQK8YANMMZ3lyt0aAZbAnkAxYoB15WwM5sTyr3veM",
} as const;

/** Ergebnisse, die als Termin/Erfolg gezählt werden (Wert im Feld „Nächster Schritt“). */
const ERFOLGE: Array<{ typ: string; wert: string; label: string }> = [
  { typ: PROTOKOLL.coldCall, wert: "Setting vereinbart am:", label: "Settings vereinbart" },
  { typ: PROTOKOLL.setting, wert: "Closing gelegt am:", label: "Closings gelegt" },
  { typ: PROTOKOLL.closing, wert: "CC2 vereinbart am:", label: "CC2 vereinbart" },
  { typ: PROTOKOLL.closing, wert: "Abgeschlossen", label: "Abschlüsse" },
];

interface Call {
  user_id: string | null;
  direction: string;
  disposition: string | null;
  duration: number | null;
  date_created: string;
}

interface Protokoll {
  user_id: string | null;
  lead_id: string;
  custom_activity_type_id: string;
  status: string;
  date_created: string;
  [feld: string]: unknown;
}

interface WaTermin {
  id: string;
  art: string;
  status: string;
  bestaetigt_am: string | null;
  start_at: string;
  email: string | null;
  name: string | null;
}

/** Geplante Termine: Terminbot-Termine (auch Close-Buchungen) + Calendly-Spiegel, doppelte zusammengefasst. */
export function geplanteTermine(
  wa: Array<Pick<WaTermin, "art" | "start_at" | "email" | "name">>,
  calendly: Array<{ event_type_name: string | null; scheduled_at: string; invitee_email: string | null; invitee_name: string | null }>,
): Array<{ art: string }> {
  const schluessel = (start: string, email: string | null, name: string | null) =>
    `${new Date(start).toISOString().slice(0, 16)}|${(email || name || "").trim().toLowerCase()}`;
  const m = new Map<string, { art: string }>();
  for (const t of wa) m.set(schluessel(t.start_at, t.email, t.name), { art: t.art });
  for (const c of calendly) {
    const art = artAusCalendly(c.event_type_name);
    if (!art) continue;
    const k = schluessel(c.scheduled_at, c.invitee_email, c.invitee_name);
    if (!m.has(k)) m.set(k, { art });
  }
  return [...m.values()];
}

export interface Zeitraum {
  von: Date;
  bis: Date;
  titel: string;
}

async function alleSeiten<T>(pfad: string, params: Record<string, string>): Promise<T[]> {
  const ergebnis: T[] = [];
  for (let skip = 0; skip < 20_000; skip += 100) {
    const r = await closeApi<{ data: T[]; has_more: boolean }>(pfad, {
      params: { ...params, _limit: "100", _skip: String(skip) },
      signal: AbortSignal.timeout(20_000),
    });
    ergebnis.push(...r.data);
    if (!r.has_more) break;
  }
  return ergebnis;
}

const imZeitraum = (iso: string, z: Zeitraum) => {
  const t = new Date(iso).getTime();
  return t >= z.von.getTime() && t < z.bis.getTime();
};

/** „ · 2 noch ohne Protokoll“, wenn geplante Termine kein Ergebnis haben */
const ohneProtokoll = (x: { geplant: number; protokolliert: number }) =>
  x.geplant > x.protokolliert ? ` · ${x.geplant - x.protokolliert} noch ohne Protokoll` : "";

/** Anzeigenamen für Close-Benutzer ohne gepflegten Namen */
const NAMEN: Record<string, string> = {
  user_8aTaFHt8ibP9z2u36XGGebbMVGJpqKcaUgpV78UMAwl: "Renney",
};

const prozent = (teil: number, von: number) => (von ? `${Math.round((teil / von) * 100)} %` : "–");
const minuten = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} Std. ${Math.round((s % 3600) / 60)} Min.` : `${Math.round(s / 60)} Min.`);

/** Berliner Tag (00:00–24:00) eines Zeitpunkts. */
export function tagZeitraum(d: Date): Zeitraum {
  const b = berlinTeile(d);
  const von = berlinZeitpunkt(b.jahr, b.monat, b.tag, 0);
  const bis = berlinZeitpunkt(b.jahr, b.monat, b.tag + 1, 0);
  return { von, bis, titel: formatDatum(von) };
}

/** Montag 00:00 bis Samstag 00:00 der Woche des Zeitpunkts. */
export function wocheZeitraum(d: Date): Zeitraum {
  const b = berlinTeile(d);
  const wochentag = (new Date(Date.UTC(b.jahr, b.monat - 1, b.tag)).getUTCDay() + 6) % 7; // Mo = 0
  const von = berlinZeitpunkt(b.jahr, b.monat, b.tag - wochentag, 0);
  const bis = berlinZeitpunkt(b.jahr, b.monat, b.tag - wochentag + 5, 0);
  const letzterTag = berlinZeitpunkt(b.jahr, b.monat, b.tag - wochentag + 4, 12);
  const kurz = (x: Date) => formatDatum(x).split(", ")[1];
  return { von, bis, titel: `${kurz(von)} – ${kurz(letzterTag)}` };
}

/** Je Lead nur das letzte Protokoll eines Typs (Nachträge/Korrekturen am selben Tag nicht doppelt zählen). */
function letzteJeLead(protokolle: Protokoll[], typ: string): Protokoll[] {
  const m = new Map<string, Protokoll>();
  for (const p of protokolle.filter((x) => x.custom_activity_type_id === typ)) {
    const alt = m.get(p.lead_id);
    if (!alt || alt.date_created < p.date_created) m.set(p.lead_id, p);
  }
  return [...m.values()];
}

/**
 * Settings/Closings im Zeitraum: geplant (Terminbot-Termine), protokolliert, erschienen (alles außer No-Show),
 * Ergebnisse aus „Nächster Schritt“. Rein, testbar.
 */
export function terminStatistik(protokolle: Protokoll[], termine: Array<{ art: string }>) {
  const sWert = (p: Protokoll) => p[ERGEBNIS_FELD[PROTOKOLL.setting]];
  const cWert = (p: Protokoll) => p[ERGEBNIS_FELD[PROTOKOLL.closing]];
  // Nur Protokolle mit Ergebnis („Nächster Schritt“) — Notizen ohne Ergebnis zählen nicht als Termin
  const setting = letzteJeLead(protokolle, PROTOKOLL.setting).filter((p) => !!sWert(p));
  const closing = letzteJeLead(protokolle, PROTOKOLL.closing).filter((p) => !!cWert(p));
  const sErschienen = setting.filter((p) => sWert(p) !== "No-Show");
  const cErschienen = closing.filter((p) => cWert(p) !== "No SHow");
  const nUnqualifiziert = sErschienen.filter((p) => sWert(p) === "Nicht qualifiziert" || sWert(p) === "Disqualifiziert").length;
  return {
    setting: {
      geplant: termine.filter((t) => t.art === "erstgespraech").length,
      protokolliert: setting.length,
      erschienen: sErschienen.length,
      noShow: setting.length - sErschienen.length,
      qualifiziert: sErschienen.length - nUnqualifiziert,
      closingGelegt: sErschienen.filter((p) => sWert(p) === "Closing gelegt am:").length,
      followUp: sErschienen.filter((p) => sWert(p) === "Follow-Up vereinbart").length,
    },
    closing: {
      geplant: termine.filter((t) => t.art === "strategie").length,
      protokolliert: closing.length,
      erschienen: cErschienen.length,
      noShow: closing.length - cErschienen.length,
      geclosed: cErschienen.filter((p) => cWert(p) === "Abgeschlossen").length,
      cc2: cErschienen.filter((p) => cWert(p) === "CC2 vereinbart am:").length,
      angebot: cErschienen.filter((p) => cWert(p) === "Angebot versendet").length,
      unqualifiziert: cErschienen.filter((p) => cWert(p) === "Unqualifiziert").length,
    },
  };
}

export async function erstelleBericht(svc: SupabaseClient, z: Zeitraum, art: "tag" | "woche") {
  const params = { date_created__gte: z.von.toISOString(), date_created__lt: z.bis.toISOString() };
  const [calls, protokolle, users, termineRes, calendlyRes] = await Promise.all([
    alleSeiten<Call>("/activity/call/", { ...params, _fields: "user_id,direction,disposition,duration,date_created" }),
    alleSeiten<Protokoll>("/activity/custom/", params),
    alleSeiten<CloseUser>("/user/", {}),
    svc
      .from("wa_termine")
      .select("id, art, status, bestaetigt_am, start_at, email, name")
      .gte("start_at", z.von.toISOString())
      .lt("start_at", z.bis.toISOString())
      .neq("status", "abgesagt"),
    svc
      .from("calendly_events")
      .select("event_type_name, scheduled_at, invitee_email, invitee_name")
      .gte("scheduled_at", z.von.toISOString())
      .lt("scheduled_at", z.bis.toISOString())
      .eq("status", "active"),
  ]);
  const name = new Map(users.map((u) => [u.id, NAMEN[u.id] ?? closeUserName(u)]));
  const wer = (id: string | null) => (id ? name.get(id) ?? "Unbekannt" : "Unbekannt");

  // Anwahlen = ausgehende Anrufe; erreicht = angenommen
  const raus = calls.filter((c) => c.direction === "outbound" && imZeitraum(c.date_created, z));
  const erreicht = raus.filter((c) => c.disposition === "answered");
  const gespraechszeit = raus.reduce((s, c) => s + (c.duration ?? 0), 0);
  const proUser = new Map<string, { anwahlen: number; erreicht: number; protokolle: number; erfolge: number }>();
  const zeile = (id: string | null) => {
    const k = wer(id);
    if (!proUser.has(k)) proUser.set(k, { anwahlen: 0, erreicht: 0, protokolle: 0, erfolge: 0 });
    return proUser.get(k)!;
  };
  for (const c of raus) {
    const r = zeile(c.user_id);
    r.anwahlen++;
    if (c.disposition === "answered") r.erreicht++;
  }

  const fertig = protokolle.filter((p) => p.status === "published" && imZeitraum(p.date_created, z));
  const anzahl = (typ: string) => fertig.filter((p) => p.custom_activity_type_id === typ).length;
  const erfolge = ERFOLGE.map((e) => ({
    ...e,
    n: fertig.filter((p) => p.custom_activity_type_id === e.typ && p[ERGEBNIS_FELD[e.typ as keyof typeof ERGEBNIS_FELD]] === e.wert)
      .length,
  }));
  for (const p of fertig) {
    const r = zeile(p.user_id);
    r.protokolle++;
    if (erfolge.some((e) => e.typ === p.custom_activity_type_id && p[ERGEBNIS_FELD[e.typ as keyof typeof ERGEBNIS_FELD]] === e.wert)) {
      r.erfolge++;
    }
  }

  // WhatsApp-Bestätigungen: Termine im Zeitraum, deren Bestätigungsanfrage zugestellt wurde
  const termine = (termineRes.data ?? []) as WaTermin[];
  const zugestellt = new Set<string>();
  for (let i = 0; i < termine.length; i += 100) {
    const { data } = await svc
      .from("wa_nachrichten")
      .select("termin_id")
      .in("termin_id", termine.slice(i, i + 100).map((t) => t.id))
      .eq("richtung", "aus")
      .eq("typ", "template")
      .in("status", ["zugestellt", "gelesen"]);
    for (const n of (data ?? []) as Array<{ termin_id: string }>) zugestellt.add(n.termin_id);
  }
  const angeschrieben = termine.filter((t) => zugestellt.has(t.id));
  const bestaetigt = angeschrieben.filter((t) => t.bestaetigt_am);
  const quoteArt = (a: string) => {
    const von = angeschrieben.filter((t) => t.art === a);
    return `${von.filter((t) => t.bestaetigt_am).length}/${von.length}`;
  };

  const team = [...proUser.entries()]
    .filter(([, r]) => r.anwahlen || r.protokolle)
    .sort((a, b) => b[1].anwahlen - a[1].anwahlen)
    .map(
      ([n, r]) =>
        `• ${n}: ${[
          r.anwahlen ? `${r.anwahlen} Anwahlen · ${r.erreicht} erreicht` : null,
          `${r.protokolle} Protokolle`,
          r.erfolge ? `${r.erfolge} ${r.erfolge === 1 ? "Termin/Abschluss" : "Termine/Abschlüsse"}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}`,
    );

  const ts = terminStatistik(
    fertig,
    geplanteTermine(termine, (calendlyRes.data ?? []) as Parameters<typeof geplanteTermine>[1]),
  );
  const zeilen = [
    `📞 *Anwahlen:* ${raus.length} · erreicht ${erreicht.length} (${prozent(erreicht.length, raus.length)}) · Gesprächszeit ${minuten(gespraechszeit)}`,
    `📝 *Protokolle:* ${fertig.length} – Cold Call ${anzahl(PROTOKOLL.coldCall)} · Setting ${anzahl(PROTOKOLL.setting)} · Closing ${anzahl(PROTOKOLL.closing)}`,
    `🎯 *Ergebnisse:* ${erfolge.map((e) => `${e.label} ${e.n}`).join(" · ")}`,
    " ",
    `🤝 *Settings:* ${ts.setting.geplant} geplant · *${ts.setting.erschienen} erschienen* (${prozent(ts.setting.erschienen, Math.max(ts.setting.geplant, ts.setting.protokolliert))}) · ${ts.setting.noShow} No-Show${ohneProtokoll(ts.setting)} · ${ts.setting.qualifiziert} qualifiziert · *${ts.setting.closingGelegt} zum Closing gelegt*${ts.setting.followUp ? ` · ${ts.setting.followUp} Follow-Up` : ""}`,
    `💼 *Closings:* ${ts.closing.geplant} geplant · *${ts.closing.erschienen} erschienen* (${prozent(ts.closing.erschienen, Math.max(ts.closing.geplant, ts.closing.protokolliert))}) · ${ts.closing.noShow} No-Show${ohneProtokoll(ts.closing)} · *${ts.closing.geclosed} geclosed* (${prozent(ts.closing.geclosed, ts.closing.erschienen)})${ts.closing.cc2 ? ` · ${ts.closing.cc2} CC2` : ""}${ts.closing.angebot ? ` · ${ts.closing.angebot} Angebot` : ""}`,
    `✅ *Termine bestätigt (WhatsApp):* ${bestaetigt.length} von ${angeschrieben.length} (${prozent(bestaetigt.length, angeschrieben.length)}) – Erstgespräch ${quoteArt("erstgespraech")} · Strategie ${quoteArt("strategie")}${termine.length > angeschrieben.length ? ` · ${termine.length - angeschrieben.length} Termin(e) ohne zugestellte WhatsApp` : ""}`,
    ...(team.length ? [" ", "*Team*", ...team] : []),
  ];

  return {
    emoji: art === "woche" ? "📈" : "📊",
    titel: art === "woche" ? `Wochenauswertung ${z.titel}` : `Tagesauswertung ${z.titel}`,
    zeilen,
  };
}

/** Vom minütlichen Cron: Mo–Fr ab 19:00 einmal pro Tag senden, freitags zusätzlich die Woche. */
export async function sendeFaelligeBerichte(svc: SupabaseClient, jetzt = new Date()): Promise<string> {
  if (!process.env.SLACK_BOT_TOKEN && !process.env.SLACK_WEBHOOK_URL) return "kein Slack";
  const b = berlinTeile(jetzt);
  const wochentag = (new Date(Date.UTC(b.jahr, b.monat - 1, b.tag)).getUTCDay() + 6) % 7;
  if (wochentag > 4 || b.stunde < BERICHT_STUNDE) return "nicht fällig";
  const heute = `${b.jahr}-${String(b.monat).padStart(2, "0")}-${String(b.tag).padStart(2, "0")}`;

  const { data } = await svc.from("wa_einstellungen").select("wert").eq("key", BERICHT_KEY).maybeSingle();
  if ((data as { wert?: string } | null)?.wert === heute) return "schon gesendet";
  // Vorab markieren: ein Fehler soll nicht jede Minute erneut senden
  const { error } = await svc
    .from("wa_einstellungen")
    .upsert({ key: BERICHT_KEY, wert: heute, updated_at: jetzt.toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`Bericht-Marker nicht gespeichert: ${error.message}`);

  await meldeSlack(await erstelleBericht(svc, tagZeitraum(jetzt), "tag"));
  if (wochentag === 4) await meldeSlack(await erstelleBericht(svc, wocheZeitraum(jetzt), "woche"));
  return wochentag === 4 ? "Tag + Woche gesendet" : "Tag gesendet";
}
