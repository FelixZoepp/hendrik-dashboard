import type { SupabaseClient } from "@supabase/supabase-js";
import { MetaFehler, sendeTextRoh, sendeVideoRoh, sendeVorlageRoh, waVerbindung } from "./client";
import { notizSicher } from "./close-log";
import { ladeEinstellungen, type WaEinstellungen } from "./einstellungen";
import { normalisiereTelefon, ruhezeitEntscheidung, versandSchluessel, waNummer, type JobTyp } from "./logik";

/**
 * Versand reservieren. Gibt die Zeilen-ID zurück oder null, wenn schon gesendet/in Arbeit.
 * Eine Reservierung mit Status 'fehlgeschlagen' (Meta hat sicher abgelehnt) gilt NICHT als
 * gesendet und wird übernommen (Update statt Insert, nur solange sie 'fehlgeschlagen' ist).
 */
async function reserviere(svc: SupabaseClient, zeile: Record<string, unknown> & { versand_schluessel: string }) {
  const { data, error } = await svc.from("wa_nachrichten").insert({ ...zeile, status: "reserviert" }).select("id").single();
  if (!error && data) return (data as { id: string }).id;
  if (error?.code !== "23505") throw new Error(`Versand nicht reserviert: ${error?.message}`);

  const { data: uebernommen, error: uFehler } = await svc
    .from("wa_nachrichten")
    .update({ ...zeile, status: "reserviert", fehler: null, wa_message_id: null })
    .eq("versand_schluessel", zeile.versand_schluessel)
    .eq("status", "fehlgeschlagen")
    .select("id");
  if (uFehler) throw new Error(`Versand nicht reserviert: ${uFehler.message}`);
  return ((uebernommen ?? []) as Array<{ id: string }>)[0]?.id ?? null;
}
import { renderBody, type VorlageDef } from "./vorlagen";
import type { Termin } from "./termine";

/**
 * ZENTRALE Sendeprüfung — einzige Stelle, über die der Bot WhatsApp-Nachrichten verschickt.
 *
 * Reihenfolge:
 * 1. Umgebungsvariablen vollständig („verbunden“)
 * 2. bot_aktiv ODER Nummer steht in testnummern
 * 3. Vorlage: in vorlagen_aktiv eingeschaltet UND bei Meta APPROVED UND Kategorie UTILITY
 * 4. Vorlage zu einem Termin: opt_in des Termins
 * 5. keine Abmeldung (opt_out) — außer der Pflicht-Bestätigung einer Abmeldung
 * 6. Freitext/Video nur im offenen 24-h-Fenster
 * 7. Ruhezeit 21–8 Uhr (nur geplante Nachrichten): auf 8:00 verschieben, außer das läge
 *    nach Terminbeginn → überspringen
 *
 * Fail-closed: Kann eine Prüfung nicht gelesen werden (DB-Fehler), wird nicht gesendet.
 * Vorlagen werden vor dem Versand reserviert (versand_schluessel, unique) → nie doppelt.
 */

/**
 * Fehler, nach dem der Job NICHT automatisch wiederholt werden darf (Job → 'fehler').
 * VersandUnklar: Timeout/Netz/5xx — Nachricht evtl. doch angekommen, Reservierung bleibt.
 */
export class OhneWiederholung extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OhneWiederholung";
  }
}

export class VersandUnklar extends OhneWiederholung {
  constructor(message: string) {
    super(message);
    this.name = "VersandUnklar";
  }
}

export type Pruefung = { ok: true } | { ok: false; grund: string; verschiebenAuf?: Date };

export type SendeErgebnis =
  | { gesendet: true; waMessageId: string }
  | { gesendet: false; grund: string; verschiebenAuf?: Date };

interface PruefOpts {
  telefon: string;
  vorlage?: VorlageDef;
  termin?: Pick<Termin, "opt_in"> | null;
  freitext?: boolean;
  /** Pflicht-Antwort (Bestätigung einer Abmeldung) — ignoriert opt_out */
  pflichtAntwort?: boolean;
  /** Ruhezeit beachten; spaetestens = Terminbeginn (null = immer verschieben) */
  ruhezeit?: { spaetestens: Date | null } | false;
  jetzt?: Date;
  einstellungen?: WaEinstellungen;
}

export function istTestnummer(e: WaEinstellungen, telefon: string): boolean {
  return e.testnummern.some((n) => normalisiereTelefon(n) === telefon);
}

export async function pruefeVersand(svc: SupabaseClient, o: PruefOpts): Promise<Pruefung> {
  const jetzt = o.jetzt ?? new Date();

  const verbindung = waVerbindung();
  if (!verbindung.verbunden) {
    return { ok: false, grund: `WhatsApp nicht verbunden (fehlt: ${verbindung.fehlend.join(", ")})` };
  }

  let e: WaEinstellungen;
  try {
    e = o.einstellungen ?? (await ladeEinstellungen(svc));
  } catch (err) {
    return { ok: false, grund: `Einstellungen nicht lesbar: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!e.bot_aktiv && !istTestnummer(e, o.telefon)) {
    return { ok: false, grund: "Bot ist aus und Nummer ist keine Testnummer" };
  }

  if (o.vorlage) {
    if (e.vorlagen_aktiv[o.vorlage.name] !== true) {
      return { ok: false, grund: `Vorlage ${o.vorlage.name} ist ausgeschaltet` };
    }
    const { data: v, error: vFehler } = await svc
      .from("wa_vorlagen")
      .select("status, kategorie")
      .eq("name", o.vorlage.name)
      .maybeSingle();
    if (vFehler) return { ok: false, grund: `Vorlagen-Status nicht lesbar: ${vFehler.message}` };
    const status = (v as { status?: string | null } | null)?.status ?? null;
    const kategorie = (v as { kategorie?: string | null } | null)?.kategorie ?? null;
    if (status !== "APPROVED") {
      return { ok: false, grund: `Vorlage ${o.vorlage.name} ist bei Meta nicht freigegeben (${status ?? "nicht eingereicht"})` };
    }
    if (kategorie?.toUpperCase() !== "UTILITY") {
      return {
        ok: false,
        grund: kategorie
          ? `Vorlage ${o.vorlage.name} wurde von Meta auf ${kategorie} umgestuft`
          : `Kategorie von ${o.vorlage.name} unbekannt — bitte Status abgleichen`,
      };
    }
    if (o.termin && !o.termin.opt_in) {
      return { ok: false, grund: "Keine WhatsApp-Einwilligung für diesen Termin" };
    }
  }

  const { data: k, error: kFehler } = await svc
    .from("wa_kontakte")
    .select("opt_out, fenster_bis")
    .eq("telefon", o.telefon)
    .maybeSingle();
  if (kFehler) return { ok: false, grund: `Kontakt nicht lesbar: ${kFehler.message}` };
  const kontakt = k as { opt_out: boolean; fenster_bis: string | null } | null;
  if (kontakt?.opt_out && !o.pflichtAntwort) {
    return { ok: false, grund: "Kontakt hat sich abgemeldet (STOP)" };
  }

  if (o.freitext) {
    const offen = kontakt?.fenster_bis && new Date(kontakt.fenster_bis).getTime() > jetzt.getTime();
    if (!offen) return { ok: false, grund: "24-h-Fenster geschlossen — nur Vorlagen erlaubt" };
  }

  if (o.ruhezeit) {
    const r = ruhezeitEntscheidung(jetzt, o.ruhezeit.spaetestens);
    if (r.aktion === "verschieben") return { ok: false, grund: "Ruhezeit (21–8 Uhr)", verschiebenAuf: r.bis };
    if (r.aktion === "ueberspringen") return { ok: false, grund: r.grund };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Protokoll
// ---------------------------------------------------------------------------

interface Protokoll {
  telefon: string;
  termin_id?: string | null;
  close_lead_id?: string | null;
  typ: string;
  vorlage?: string | null;
  body: string;
  payload?: unknown;
}

async function protokolliere(
  svc: SupabaseClient,
  p: Protokoll,
  ergebnis: { waMessageId: string } | { fehler: string },
): Promise<void> {
  const ok = "waMessageId" in ergebnis;
  const { error } = await svc.from("wa_nachrichten").insert({
    richtung: "aus",
    telefon: p.telefon,
    termin_id: p.termin_id ?? null,
    close_lead_id: p.close_lead_id ?? null,
    typ: p.typ,
    vorlage: p.vorlage ?? null,
    body: p.body,
    wa_message_id: ok ? ergebnis.waMessageId : null,
    status: ok ? "gesendet" : "fehlgeschlagen",
    fehler: ok ? null : ergebnis.fehler.slice(0, 500),
    payload: p.payload ?? null,
  });
  if (error) console.error("[whatsapp] Nachricht nicht protokolliert:", error.message);
  if (ok) {
    await notizSicher(
      p.close_lead_id,
      `WhatsApp gesendet${p.vorlage ? `: ${p.vorlage}` : ""}\n\n${p.body}`,
    );
  }
}

async function sendeUndProtokolliere(
  svc: SupabaseClient,
  p: Protokoll,
  senden: () => Promise<string>,
): Promise<SendeErgebnis> {
  try {
    const waMessageId = await senden();
    await protokolliere(svc, p, { waMessageId });
    return { gesendet: true, waMessageId };
  } catch (err) {
    const fehler = err instanceof Error ? err.message : String(err);
    await protokolliere(svc, p, { fehler });
    throw err instanceof Error ? err : new Error(fehler);
  }
}

// ---------------------------------------------------------------------------
// Senden
// ---------------------------------------------------------------------------

/**
 * Vorlage zu einem Termin senden (Werte = {{1}}, {{2}} …; Knöpfe bekommen Token bzw. Payload).
 * Ablauf: Prüfung → Reservierung (unique versand_schluessel) → Meta → Ergebnis.
 * - 23505 bei der Reservierung: schon gesendet/in Arbeit → nicht senden
 * - Meta antwortet 4xx (sicher nicht gesendet): Reservierung freigeben, Fehler werfen
 * - Timeout/Netz/5xx (unklar): Reservierung bleibt, VersandUnklar werfen → kein Neuversand
 */
export async function sendeVorlage(
  svc: SupabaseClient,
  o: {
    termin: Termin;
    typ: JobTyp;
    vorlage: VorlageDef;
    werte: string[];
    ruhezeit: { spaetestens: Date | null } | false;
    jetzt?: Date;
  },
): Promise<SendeErgebnis> {
  const telefon = o.termin.telefon;
  if (!telefon) return { gesendet: false, grund: "Keine Telefonnummer" };
  const pruefung = await pruefeVersand(svc, {
    telefon,
    vorlage: o.vorlage,
    termin: o.termin,
    ruhezeit: o.ruhezeit,
    jetzt: o.jetzt,
  });
  if (!pruefung.ok) return { gesendet: false, grund: pruefung.grund, verschiebenAuf: pruefung.verschiebenAuf };

  const components: Array<Record<string, unknown>> = [
    { type: "body", parameters: o.werte.map((text) => ({ type: "text", text })) },
  ];
  o.vorlage.buttons.forEach((b, index) => {
    components.push(
      b.typ === "QUICK_REPLY"
        ? {
            type: "button",
            sub_type: "quick_reply",
            index: String(index),
            parameters: [{ type: "payload", payload: `${b.aktion}|${o.termin.id}` }],
          }
        : {
            type: "button",
            sub_type: "url",
            index: String(index),
            parameters: [{ type: "text", text: o.termin.token }],
          },
    );
  });
  const body = renderBody(o.vorlage, o.werte);

  // Reservierung (je Termin + Typ + Start genau einmal)
  const zeileId = await reserviere(svc, {
    richtung: "aus",
    telefon,
    termin_id: o.termin.id,
    close_lead_id: o.termin.close_lead_id,
    typ: "template",
    vorlage: o.vorlage.name,
    body,
    versand_schluessel: versandSchluessel(o.termin.id, o.typ, new Date(o.termin.start_at)),
    payload: { components },
  });
  if (!zeileId) return { gesendet: false, grund: "bereits gesendet" };

  let waMessageId: string;
  try {
    waMessageId = await sendeVorlageRoh(waNummer(telefon), o.vorlage.name, o.vorlage.sprache, components);
  } catch (err) {
    const fehler = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    if (err instanceof MetaFehler && err.eindeutig) {
      // Sicher nicht gesendet → als 'fehlgeschlagen' markieren (Schlüssel bleibt, darf übernommen werden)
      const { error: fFehler } = await svc
        .from("wa_nachrichten")
        .update({ status: "fehlgeschlagen", fehler })
        .eq("id", zeileId)
        .eq("status", "reserviert");
      if (fFehler) {
        throw new OhneWiederholung(`Reservierung nicht freigegeben, bitte prüfen (${fFehler.message}) — Meta: ${fehler}`);
      }
      throw err;
    }
    await svc.from("wa_nachrichten").update({ fehler: `Ergebnis unklar: ${fehler}` }).eq("id", zeileId);
    throw new VersandUnklar(`Ergebnis unklar (kein automatischer Neuversand): ${fehler}`);
  }

  const { error: uFehler } = await svc
    .from("wa_nachrichten")
    .update({ status: "gesendet", wa_message_id: waMessageId })
    .eq("id", zeileId);
  if (uFehler) console.error("[whatsapp] Versand nicht protokolliert:", uFehler.message);
  await notizSicher(o.termin.close_lead_id, `WhatsApp gesendet: ${o.vorlage.name}\n\n${body}`);
  return { gesendet: true, waMessageId };
}

/** Freitext — nur im offenen 24-h-Fenster (Antwort auf eine Nachricht des Kontakts). */
export async function sendeFreitext(
  svc: SupabaseClient,
  o: {
    telefon: string;
    text: string;
    termin?: Termin | null;
    closeLeadId?: string | null;
    pflichtAntwort?: boolean;
    typ?: string;
  },
): Promise<SendeErgebnis> {
  const pruefung = await pruefeVersand(svc, {
    telefon: o.telefon,
    freitext: true,
    pflichtAntwort: o.pflichtAntwort,
  });
  if (!pruefung.ok) return { gesendet: false, grund: pruefung.grund };
  return sendeUndProtokolliere(
    svc,
    {
      telefon: o.telefon,
      termin_id: o.termin?.id ?? null,
      close_lead_id: o.closeLeadId ?? o.termin?.close_lead_id ?? null,
      typ: o.typ ?? "text",
      body: o.text,
    },
    () => sendeTextRoh(waNummer(o.telefon), o.text),
  );
}

/** Video per Link (mp4/3gp) — ebenfalls nur im offenen 24-h-Fenster. */
export async function sendeVideo(
  svc: SupabaseClient,
  o: { telefon: string; link: string; caption?: string; termin?: Termin | null; closeLeadId?: string | null },
): Promise<SendeErgebnis> {
  const pruefung = await pruefeVersand(svc, { telefon: o.telefon, freitext: true });
  if (!pruefung.ok) return { gesendet: false, grund: pruefung.grund };
  return sendeUndProtokolliere(
    svc,
    {
      telefon: o.telefon,
      termin_id: o.termin?.id ?? null,
      close_lead_id: o.closeLeadId ?? o.termin?.close_lead_id ?? null,
      typ: "video",
      body: `[Video] ${o.link}${o.caption ? `\n${o.caption}` : ""}`,
    },
    () => sendeVideoRoh(waNummer(o.telefon), o.link, o.caption),
  );
}

/** Video-Link, den WhatsApp direkt als Video abspielen kann (mp4/3gp). */
/** YouTube-, Vimeo- oder Loom-Link → einbettbare Player-URL (sonst null). */
export function videoEinbettung(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, "");
  const id = (s: string | null | undefined) => (s && /^[\w-]{6,}$/.test(s) ? s : null);
  if (host === "youtu.be") {
    const v = id(u.pathname.split("/")[1]);
    return v ? `https://www.youtube-nocookie.com/embed/${v}?rel=0` : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const teile = u.pathname.split("/").filter(Boolean);
    const v = id(u.searchParams.get("v")) ?? (["shorts", "embed", "live"].includes(teile[0]) ? id(teile[1]) : null);
    return v ? `https://www.youtube-nocookie.com/embed/${v}?rel=0` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const teile = u.pathname.split("/").filter(Boolean);
    const v = teile.find((t) => /^\d+$/.test(t));
    const hash = teile[teile.indexOf(v ?? "") + 1];
    if (!v) return null;
    return `https://player.vimeo.com/video/${v}${hash && /^[a-f0-9]+$/i.test(hash) ? `?h=${hash}` : ""}`;
  }
  if (host === "loom.com") {
    const teile = u.pathname.split("/").filter(Boolean);
    const v = ["share", "embed"].includes(teile[0]) ? id(teile[1]) : null;
    return v ? `https://www.loom.com/embed/${v}` : null;
  }
  return null;
}

export function istDirektesVideo(url: string): boolean {
  try {
    return /\.(mp4|3gpp?)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
