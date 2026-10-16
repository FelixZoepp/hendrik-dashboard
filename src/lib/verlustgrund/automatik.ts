import type { SupabaseClient } from "@supabase/supabase-js";
import { closeApi } from "@/lib/integrations/close";
import {
  alsCustomKey,
  aufgabenText,
  berlinerTag,
  hatOffeneAufgabe,
  istGrundGesetzt,
  offeneVerlusteOhneGrund,
  PROTOKOLL_TYP,
  schonErinnert,
  setzeMarker,
  verlustAusProtokoll,
  VERLUSTGRUENDE,
  VERLUSTGRUND_FELDNAME,
  type AufgabenMarker,
  type OppKurz,
} from "./logik";

/**
 * Verlustgrund-Automatik (Server). Schalter und Feld-IDs liegen in wa_einstellungen:
 * - verlustgrund_automatisch (bool, Standard aus): Grund aus dem Protokoll in die verlorene Opportunity übernehmen
 * - verlustgrund_aufgabe (bool, Standard aus): ohne Grund Close-Aufgabe „Verlustgrund eintragen“
 * - verlustgrund_feld / setting_grund_feld / closing_grund_feld: "custom.cf_…" (per „Felder in Close anlegen“)
 * - verlustgrund_aufgaben: Dedupe-Marker { oppId: "YYYY-MM-DD" } (pro Opportunity und Tag eine Aufgabe)
 * Schreibt nur in Close (Feld + Aufgabe fürs Team) — nie eine Nachricht an Leads.
 */

export interface VerlustgrundEinstellungen {
  automatisch: boolean;
  aufgabe: boolean;
  verlustgrundFeld: string | null;
  settingGrundFeld: string | null;
  closingGrundFeld: string | null;
  marker: AufgabenMarker;
}

const KEYS = [
  "verlustgrund_automatisch",
  "verlustgrund_aufgabe",
  "verlustgrund_feld",
  "setting_grund_feld",
  "closing_grund_feld",
  "verlustgrund_aufgaben",
] as const;
type Key = (typeof KEYS)[number];

export async function ladeVerlustgrundEinstellungen(svc: SupabaseClient): Promise<VerlustgrundEinstellungen> {
  const { data, error } = await svc.from("wa_einstellungen").select("key, wert").in("key", [...KEYS]);
  if (error) throw new Error(`Verlustgrund-Einstellungen nicht lesbar: ${error.message}`);
  const w = new Map(((data ?? []) as Array<{ key: string; wert: unknown }>).map((r) => [r.key, r.wert]));
  const text = (k: Key) => (typeof w.get(k) === "string" ? alsCustomKey(w.get(k) as string) : null);
  const m = w.get("verlustgrund_aufgaben");
  return {
    automatisch: w.get("verlustgrund_automatisch") === true,
    aufgabe: w.get("verlustgrund_aufgabe") === true,
    verlustgrundFeld: text("verlustgrund_feld"),
    settingGrundFeld: text("setting_grund_feld"),
    closingGrundFeld: text("closing_grund_feld"),
    marker: m && typeof m === "object" && !Array.isArray(m) ? (m as AufgabenMarker) : {},
  };
}

export async function speichereVerlustgrundWert(svc: SupabaseClient, key: Key, wert: unknown): Promise<void> {
  const { error } = await svc
    .from("wa_einstellungen")
    .upsert({ key, wert, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`Einstellung ${key} nicht gespeichert: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Einrichtung (Knopf „Felder in Close anlegen“, PIN-geschützt)
// ---------------------------------------------------------------------------

interface CloseFeld {
  id: string;
  name: string;
  type?: string;
  choices?: string[] | null;
  custom_activity_type_id?: string | null;
}

/**
 * Auswahlfeld finden bzw. anlegen; fehlende Gründe an einem vorhandenen Feld ergänzen (nichts löschen).
 * Close-API (developer.close.com, Custom Fields):
 * - Opportunity: GET/POST /custom_field/opportunity/, PUT /custom_field/opportunity/{id}/
 * - Protokoll-Feld: GET/POST /custom_field/activity/ mit custom_activity_type_id (Feld gehört genau zu diesem Typ,
 *   erscheint unten im Protokoll-Formular), PUT /custom_field/activity/{id}/
 * Annahme: POST mit {name, type: "choices", choices, accepts_multiple_values: false} — wie bei den Lead-Feldern
 * in lib/whatsapp/einrichtung.ts. Werte werden als "custom.cf_…" gelesen/geschrieben.
 */
async function sichereAuswahlFeld(
  art: "opportunity" | "activity",
  activityTypeId?: string,
): Promise<{ feld: string; neu: boolean; ergaenzt: number }> {
  const choices: string[] = [...VERLUSTGRUENDE];
  const { data } = await closeApi<{ data: CloseFeld[] }>(`/custom_field/${art}/`, { params: { _limit: "200" } });
  const vorhanden = data.find(
    (f) =>
      f.name.trim().toLowerCase() === VERLUSTGRUND_FELDNAME.toLowerCase() &&
      (art === "opportunity" || f.custom_activity_type_id === activityTypeId),
  );
  if (vorhanden) {
    if (vorhanden.type && vorhanden.type !== "choices") {
      throw new Error(`Feld „${VERLUSTGRUND_FELDNAME}“ (${art}) existiert schon mit Typ ${vorhanden.type} (erwartet: Auswahl)`);
    }
    const fehlend = choices.filter((c) => !(vorhanden.choices ?? []).includes(c));
    if (fehlend.length) {
      await closeApi(`/custom_field/${art}/${vorhanden.id}/`, {
        method: "PUT",
        body: { choices: [...(vorhanden.choices ?? []), ...fehlend] },
      });
    }
    return { feld: `custom.${vorhanden.id}`, neu: false, ergaenzt: fehlend.length };
  }
  const f = await closeApi<{ id: string }>(`/custom_field/${art}/`, {
    method: "POST",
    body: {
      name: VERLUSTGRUND_FELDNAME,
      type: "choices",
      choices,
      accepts_multiple_values: false,
      ...(activityTypeId ? { custom_activity_type_id: activityTypeId } : {}),
    },
  });
  return { feld: `custom.${f.id}`, neu: true, ergaenzt: 0 };
}

/** Alle drei Felder anlegen/finden und die IDs speichern. Idempotent; jeder Schritt einzeln. */
export async function legeVerlustgrundFelderAn(svc: SupabaseClient): Promise<string[]> {
  const schritte: Array<[string, Key, () => ReturnType<typeof sichereAuswahlFeld>]> = [
    ["Opportunity", "verlustgrund_feld", () => sichereAuswahlFeld("opportunity")],
    ["Setting-Protokoll", "setting_grund_feld", () => sichereAuswahlFeld("activity", PROTOKOLL_TYP.setting)],
    ["Closing-Protokoll", "closing_grund_feld", () => sichereAuswahlFeld("activity", PROTOKOLL_TYP.closing)],
  ];
  const bericht: string[] = [];
  for (const [label, key, lauf] of schritte) {
    try {
      const r = await lauf();
      await speichereVerlustgrundWert(svc, key, r.feld);
      bericht.push(`${label}: ${r.neu ? "angelegt" : r.ergaenzt ? `gefunden, ${r.ergaenzt} Gründe ergänzt` : "gefunden"} (${r.feld})`);
    } catch (err) {
      bericht.push(`${label}: Fehler – ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return bericht;
}

// ---------------------------------------------------------------------------
// Aufgabe „Verlustgrund eintragen“
// ---------------------------------------------------------------------------

/** Aufgabe anlegen — höchstens einmal pro Opportunity und Tag, nicht bei schon offener Aufgabe. */
async function erinnere(
  svc: SupabaseClient,
  e: VerlustgrundEinstellungen,
  opp: { id: string; lead_id: string; lead_name?: string | null },
  zustaendig: string | null | undefined,
): Promise<"aufgabe" | "schon_erinnert" | "offene_aufgabe"> {
  const tag = berlinerTag(new Date());
  if (schonErinnert(e.marker, opp.id, tag)) return "schon_erinnert";
  const { data: offene } = await closeApi<{ data: Array<{ text: string | null; is_complete?: boolean }> }>("/task/", {
    params: { lead_id: opp.lead_id, is_complete: "false", _limit: "100" },
  });
  if (hatOffeneAufgabe(offene)) return "offene_aufgabe";
  // Marker vor dem Anlegen setzen: lieber einmal keine als zwei Aufgaben
  e.marker = setzeMarker(e.marker, opp.id, tag);
  await speichereVerlustgrundWert(svc, "verlustgrund_aufgaben", e.marker);
  await closeApi("/task/", {
    method: "POST",
    body: {
      _type: "lead",
      lead_id: opp.lead_id,
      text: aufgabenText(opp.lead_name),
      date: tag,
      ...(zustaendig ? { assigned_to: zustaendig } : {}),
    },
  });
  return "aufgabe";
}

interface CloseOpp extends Record<string, unknown> {
  id: string;
  lead_id: string;
  lead_name?: string | null;
  user_id?: string | null;
  status_id: string;
  status_type: string;
  date_updated: string;
}

/**
 * Close-Webhook: Protokoll hat die Opportunity auf „Verloren“ gesetzt (oder ein bereits verlorenes
 * Protokoll wurde nachträglich bearbeitet). Grund übernehmen bzw. Aufgabe für den Protokoll-Ersteller.
 * @param oppId die gerade verschobene Opportunity; sonst die zuletzt geänderte verlorene der letzten 3 Tage
 */
export async function verlustgrundAusWebhook(
  svc: SupabaseClient,
  protokoll: Record<string, unknown> & { lead_id: string },
  oppId: string | null,
): Promise<string> {
  const e = await ladeVerlustgrundEinstellungen(svc);
  if (!e.automatisch && !e.aufgabe) return "aus";
  if (!e.verlustgrundFeld) return "kein_feld";
  const info = verlustAusProtokoll(protokoll, { setting: e.settingGrundFeld, closing: e.closingGrundFeld });
  if (!info.verloren) return "nicht_verloren";

  let opp: CloseOpp | undefined;
  if (oppId) {
    opp = await closeApi<CloseOpp>(`/opportunity/${oppId}/`);
  } else {
    const { data } = await closeApi<{ data: CloseOpp[] }>("/opportunity/", {
      params: { lead_id: protokoll.lead_id, _limit: "50" },
    });
    const grenze = Date.now() - 3 * 864e5;
    opp = data
      .filter((o) => o.status_type === "lost" && Date.parse(o.date_updated) >= grenze)
      .sort((a, b) => b.date_updated.localeCompare(a.date_updated))[0];
  }
  if (!opp || opp.status_type !== "lost") return "keine_verlorene_opp";
  if (istGrundGesetzt(opp[e.verlustgrundFeld])) return "grund_vorhanden";

  if (info.grund && e.automatisch) {
    await closeApi(`/opportunity/${opp.id}/`, { method: "PUT", body: { [e.verlustgrundFeld]: info.grund } });
    return `eingetragen: ${info.grund}`;
  }
  if (!e.aufgabe) return "ohne_grund_aufgabe_aus";
  return erinnere(svc, e, opp, (protokoll.user_id as string | undefined) ?? opp.user_id);
}

/**
 * Close-Sync (stündlich): Opportunities, die manuell auf verloren gesetzt wurden und nach 30 Min.
 * noch keinen Grund haben → Aufgabe für den Opp-Verantwortlichen. Max. 25 pro Lauf.
 */
export async function pruefeVerloreneOpps(svc: SupabaseClient, opps: OppKurz[]): Promise<Record<string, number>> {
  const e = await ladeVerlustgrundEinstellungen(svc);
  const stand: Record<string, number> = {};
  if (!e.aufgabe || !e.verlustgrundFeld) return stand;
  const feld = e.verlustgrundFeld;
  for (const kandidat of offeneVerlusteOhneGrund(opps, feld, e.marker, new Date()).slice(0, 25)) {
    // Aktuellen Stand holen (Listen-Daten können veraltet sein bzw. Custom Fields fehlen)
    const opp = await closeApi<CloseOpp>(`/opportunity/${kandidat.id}/`);
    const r = opp.status_type !== "lost" ? "nicht_verloren" : istGrundGesetzt(opp[feld]) ? "grund_vorhanden" : await erinnere(svc, e, opp, opp.user_id);
    stand[r] = (stand[r] ?? 0) + 1;
  }
  return stand;
}
