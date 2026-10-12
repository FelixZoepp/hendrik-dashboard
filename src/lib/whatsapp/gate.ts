import type { SupabaseClient } from "@supabase/supabase-js";
import { sendeTextRoh, sendeVideoRoh, sendeVorlageRoh, waVerbindung } from "./client";
import { notizSicher } from "./close-log";
import { ladeEinstellungen, type WaEinstellungen } from "./einstellungen";
import { normalisiereTelefon, ruhezeitEntscheidung, waNummer } from "./logik";
import { renderBody, type VorlageDef } from "./vorlagen";
import type { Termin } from "./termine";

/**
 * ZENTRALE Sendeprüfung — einzige Stelle, über die der Bot WhatsApp-Nachrichten verschickt.
 *
 * Reihenfolge:
 * 1. Umgebungsvariablen vollständig („verbunden“)
 * 2. bot_aktiv ODER Nummer steht in testnummern
 * 3. Vorlage: in vorlagen_aktiv eingeschaltet UND bei Meta APPROVED
 * 4. Vorlage zu einem Termin: opt_in des Termins
 * 5. keine Abmeldung (opt_out) — außer der Pflicht-Bestätigung einer Abmeldung
 * 6. Freitext/Video nur im offenen 24-h-Fenster
 * 7. Ruhezeit 21–8 Uhr (nur geplante Nachrichten): auf 8:00 verschieben, außer das läge
 *    nach Terminbeginn → überspringen
 */

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

  const e = o.einstellungen ?? (await ladeEinstellungen(svc));
  if (!e.bot_aktiv && !istTestnummer(e, o.telefon)) {
    return { ok: false, grund: "Bot ist aus und Nummer ist keine Testnummer" };
  }

  if (o.vorlage) {
    if (e.vorlagen_aktiv[o.vorlage.name] !== true) {
      return { ok: false, grund: `Vorlage ${o.vorlage.name} ist ausgeschaltet` };
    }
    const { data: v } = await svc.from("wa_vorlagen").select("status").eq("name", o.vorlage.name).maybeSingle();
    const status = (v as { status?: string | null } | null)?.status ?? null;
    if (status !== "APPROVED") {
      return { ok: false, grund: `Vorlage ${o.vorlage.name} ist bei Meta nicht freigegeben (${status ?? "nicht eingereicht"})` };
    }
    if (o.termin && !o.termin.opt_in) {
      return { ok: false, grund: "Keine WhatsApp-Einwilligung für diesen Termin" };
    }
  }

  const { data: k } = await svc
    .from("wa_kontakte")
    .select("opt_out, fenster_bis")
    .eq("telefon", o.telefon)
    .maybeSingle();
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

/** Vorlage zu einem Termin senden (Werte = {{1}}, {{2}} …; Knöpfe bekommen Token bzw. Payload). */
export async function sendeVorlage(
  svc: SupabaseClient,
  o: {
    termin: Termin;
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

  return sendeUndProtokolliere(
    svc,
    {
      telefon,
      termin_id: o.termin.id,
      close_lead_id: o.termin.close_lead_id,
      typ: "template",
      vorlage: o.vorlage.name,
      body: renderBody(o.vorlage, o.werte),
      payload: { components },
    },
    () => sendeVorlageRoh(waNummer(telefon), o.vorlage.name, o.vorlage.sprache, components),
  );
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
export function istDirektesVideo(url: string): boolean {
  try {
    return /\.(mp4|3gpp?)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
