import type { SupabaseClient } from "@supabase/supabase-js";
import { aufgabeAnLead, findeCloseLead, notizSicher } from "./close-log";
import { ladeEinstellungen } from "./einstellungen";
import { istDirektesVideo, sendeFreitext, sendeVideo } from "./gate";
import { berlinDatum, erkenneAntwort, formatDatum, formatUhrzeit, normalisiereTelefon } from "./logik";
import { brecheJobsAb, type Termin } from "./termine";
import { AUFGABEN, FREITEXTE } from "./vorlagen";

/**
 * Eingehende WhatsApp-Nachrichten: 24-h-Fenster öffnen, speichern, an Close notieren,
 * Bestätigung / Verschiebewunsch / STOP erkennen, sonst Close-Aufgabe „WhatsApp beantworten“.
 * Freitext-Antworten laufen durch gate.ts; Close-Notizen/Aufgaben gehen immer.
 */

export interface Eingang {
  telefonRoh: string;
  waMessageId: string;
  typ: string;
  text: string;
  /** Payload eines Quick-Reply-Knopfs, z. B. "bestaetigen|<termin-id>" */
  buttonPayload?: string | null;
  zeit: Date;
  payload?: unknown;
}

const wann = (t: Termin) => `${formatDatum(new Date(t.start_at))} um ${formatUhrzeit(new Date(t.start_at))} Uhr`;
const artLabel = (t: Termin) => (t.art === "strategie" ? "Strategiegespräch" : "Erstgespräch");

async function terminZurNachricht(svc: SupabaseClient, telefon: string, payload: string | null | undefined, jetzt: Date) {
  const terminId = payload?.split("|")[1];
  if (terminId && /^[0-9a-f-]{36}$/i.test(terminId)) {
    const { data } = await svc.from("wa_termine").select("*").eq("id", terminId).eq("telefon", telefon).maybeSingle();
    if (data) return data as Termin;
  }
  const { data } = await svc
    .from("wa_termine")
    .select("*")
    .eq("telefon", telefon)
    .eq("status", "geplant")
    .gte("start_at", new Date(jetzt.getTime() - 2 * 60 * 60_000).toISOString())
    .order("start_at", { ascending: true })
    .limit(1);
  return ((data as Termin[] | null) ?? [])[0] ?? null;
}

export async function verarbeiteEingang(svc: SupabaseClient, e: Eingang): Promise<Record<string, unknown>> {
  const telefon = normalisiereTelefon(e.telefonRoh);
  if (!telefon) return { ignoriert: "Nummer unbrauchbar" };
  const jetzt = e.zeit;

  // Doppelte Zustellung durch Meta → nur einmal verarbeiten
  const { data: vorhanden } = await svc.from("wa_nachrichten").select("id").eq("wa_message_id", e.waMessageId).maybeSingle();
  if (vorhanden) return { ignoriert: "bereits verarbeitet" };

  const termin = await terminZurNachricht(svc, telefon, e.buttonPayload, jetzt);
  const { data: k } = await svc.from("wa_kontakte").select("close_lead_id").eq("telefon", telefon).maybeSingle();
  let closeLeadId =
    termin?.close_lead_id ?? (k as { close_lead_id: string | null } | null)?.close_lead_id ?? null;
  if (!closeLeadId) closeLeadId = await findeCloseLead(svc, { telefon }).catch(() => null);

  await svc.from("wa_kontakte").upsert(
    {
      telefon,
      fenster_bis: new Date(jetzt.getTime() + 24 * 60 * 60_000).toISOString(),
      ...(closeLeadId ? { close_lead_id: closeLeadId } : {}),
      updated_at: jetzt.toISOString(),
    },
    { onConflict: "telefon" },
  );

  const { error: insertFehler } = await svc.from("wa_nachrichten").insert({
    richtung: "ein",
    telefon,
    termin_id: termin?.id ?? null,
    close_lead_id: closeLeadId,
    typ: e.typ,
    body: e.text,
    wa_message_id: e.waMessageId,
    status: "empfangen",
    payload: e.payload ?? null,
  });
  if (insertFehler?.code === "23505") return { ignoriert: "bereits verarbeitet" };
  if (insertFehler) throw new Error(`Nachricht nicht gespeichert: ${insertFehler.message}`);

  await notizSicher(closeLeadId, `WhatsApp empfangen: ${e.text || `[${e.typ}]`}`);

  const knopf = e.buttonPayload?.split("|")[0];
  const art =
    knopf === "bestaetigen" ? "bestaetigen" : knopf === "verschieben" ? "verschieben" : erkenneAntwort(e.text);

  if (art === "stop") {
    await svc.from("wa_kontakte").update({ opt_out: true, updated_at: jetzt.toISOString() }).eq("telefon", telefon);
    const { data: offen } = await svc.from("wa_termine").select("id").eq("telefon", telefon).eq("status", "geplant");
    await brecheJobsAb(
      svc,
      ((offen ?? []) as Array<{ id: string }>).map((t) => t.id),
      "Kontakt hat sich abgemeldet (STOP)",
    );
    await sendeFreitext(svc, { telefon, text: FREITEXTE.stop, termin, closeLeadId, pflichtAntwort: true });
    await notizSicher(closeLeadId, "WhatsApp abgemeldet (STOP) – der Bot sendet keine Nachrichten mehr an diese Nummer.");
    return { aktion: "stop" };
  }

  if (art === "bestaetigen" && termin) {
    return { aktion: "bestaetigt", ...(await bestaetigeTermin(svc, termin, { quelle: "whatsapp", jetzt })) };
  }

  if (art === "verschieben" && termin) {
    return { aktion: "verschieben", ...(await verschiebeWunsch(svc, termin, { quelle: "whatsapp", jetzt })) };
  }

  // Alles andere: ein Mensch antwortet (max. 1 offene Aufgabe pro Lead/Tag)
  const aufgabe = await aufgabeAnLead(closeLeadId, AUFGABEN.beantworten, {
    datum: berlinDatum(jetzt),
    zustaendig: termin?.close_user_id ?? null,
  }).catch(() => null);
  return { aktion: "aufgabe", aufgabe, closeLeadId };
}

/**
 * Termin bestätigen (Knopf „Ich bin dabei“, Antwort „ja“ oder Termin-Seite).
 * Danke-Nachricht + Video nur, wenn das 24-h-Fenster offen ist (Gate).
 */
export async function bestaetigeTermin(
  svc: SupabaseClient,
  termin: Termin,
  opts: { quelle: "whatsapp" | "seite"; jetzt?: Date },
): Promise<Record<string, unknown>> {
  const jetzt = opts.jetzt ?? new Date();
  if (termin.status !== "geplant") return { ignoriert: `Termin ist ${termin.status}` };
  if (termin.bestaetigt_am) return { ignoriert: "bereits bestätigt" };

  const { data } = await svc
    .from("wa_termine")
    .update({ bestaetigt_am: jetzt.toISOString() })
    .eq("id", termin.id)
    .is("bestaetigt_am", null)
    .select("id");
  if (!data?.length) return { ignoriert: "bereits bestätigt" };

  await notizSicher(
    termin.close_lead_id,
    `${artLabel(termin)} am ${wann(termin)} ${opts.quelle === "seite" ? "über die Termin-Seite" : "per WhatsApp"} bestätigt`,
  );

  if (!termin.telefon) return { gesendet: false };
  const video = (await ladeEinstellungen(svc)).videos[termin.art];
  const direkt = video ? istDirektesVideo(video) : false;
  const text = video
    ? direkt
      ? FREITEXTE.bestaetigtMitVideo
      : `${FREITEXTE.bestaetigtMitVideo}\n\n${video}`
    : FREITEXTE.bestaetigt;
  const r = await sendeFreitext(svc, { telefon: termin.telefon, text, termin, typ: "text" });
  if (r.gesendet && video && direkt) {
    await sendeVideo(svc, { telefon: termin.telefon, link: video, termin }).catch((err) =>
      console.error("[whatsapp] Video nicht gesendet:", err),
    );
  }
  return { gesendet: r.gesendet, ...(r.gesendet ? {} : { grund: r.grund }) };
}

/** Verschiebewunsch: Antwort (Link oder „wir melden uns“) + Close-Aufgabe für heute. */
export async function verschiebeWunsch(
  svc: SupabaseClient,
  termin: Termin,
  opts: { quelle: "whatsapp" | "seite"; jetzt?: Date },
): Promise<Record<string, unknown>> {
  const jetzt = opts.jetzt ?? new Date();
  if (termin.status !== "geplant") return { ignoriert: `Termin ist ${termin.status}` };
  await svc.from("wa_termine").update({ verschieben_am: jetzt.toISOString() }).eq("id", termin.id);

  const aufgabe = await aufgabeAnLead(termin.close_lead_id, AUFGABEN.verschieben, {
    datum: berlinDatum(jetzt),
    zustaendig: termin.close_user_id,
  }).catch((err) => {
    console.error("[whatsapp] Close-Aufgabe fehlgeschlagen:", err);
    return null;
  });
  await notizSicher(
    termin.close_lead_id,
    `Lead möchte ${artLabel(termin)} am ${wann(termin)} verschieben (${opts.quelle === "seite" ? "Termin-Seite" : "WhatsApp"})`,
  );

  if (opts.quelle !== "whatsapp" || !termin.telefon) return { aufgabe };
  const text = termin.reschedule_url
    ? FREITEXTE.verschiebenMitLink(termin.reschedule_url)
    : FREITEXTE.verschiebenOhneLink;
  const r = await sendeFreitext(svc, { telefon: termin.telefon, text, termin });
  return { aufgabe, gesendet: r.gesendet };
}
