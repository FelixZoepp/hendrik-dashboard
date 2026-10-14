import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Schutz der Bot-Schalter im Dashboard (Auth ist im Projekt deaktiviert):
 * Eingabe von WHATSAPP_ADMIN_PIN → httpOnly-Cookie mit Ablaufzeit + HMAC (nicht der PIN selbst).
 * PIN mindestens 10 Zeichen; nach 5 Fehlversuchen (global, in der DB gezählt) 15 Min. Sperre.
 */

export const PIN_MINDESTLAENGE = 10;
const MAX_FEHLVERSUCHE = 5;
const SPERRE_MS = 15 * 60_000;
const SPERR_KEY = "pin_sperre";

const COOKIE = "wa_admin";
const GUELTIG_S = 12 * 60 * 60;
// Gilt für alle geschützten Sales-Seiten (WhatsApp-Bot, Chats, Gespräche).
// Früher /sales/whatsapp — solche Cookies laufen nach spätestens 12 Std. von selbst ab.
const COOKIE_PFAD = "/sales";

function sollPin(): string | null {
  const pin = process.env.WHATSAPP_ADMIN_PIN?.trim();
  return pin && pin.length >= PIN_MINDESTLAENGE ? pin : null;
}

function schluessel(): Buffer | null {
  const pin = sollPin();
  if (!pin) return null;
  // Server-Geheimnis einmischen, damit das Cookie nicht offline per PIN-Raten gefälscht werden kann
  return createHash("sha256")
    .update(`wa-admin|${pin}|${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}|${process.env.META_APP_SECRET ?? ""}`)
    .digest();
}

function signiere(ablauf: number, key: Buffer): string {
  return createHmac("sha256", key).update(`wa-admin:${ablauf}`).digest("hex");
}

function gleich(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** "fehlt" | "zu_kurz" | "ok" */
export function adminPinZustand(): "fehlt" | "zu_kurz" | "ok" {
  const pin = process.env.WHATSAPP_ADMIN_PIN?.trim();
  if (!pin) return "fehlt";
  return pin.length < PIN_MINDESTLAENGE ? "zu_kurz" : "ok";
}

interface PinSperre {
  fehlversuche: number;
  gesperrt_bis: string | null;
}

async function ladeSperre(): Promise<PinSperre> {
  const { data, error } = await createAdminClient().from("wa_einstellungen").select("wert").eq("key", SPERR_KEY).maybeSingle();
  if (error) throw new Error(`PIN-Sperre nicht lesbar: ${error.message}`);
  const w = (data as { wert?: Partial<PinSperre> } | null)?.wert;
  return { fehlversuche: Number(w?.fehlversuche ?? 0), gesperrt_bis: w?.gesperrt_bis ?? null };
}

/** Fehlversuch atomar zählen (SQL-Funktion: Zähler + Sperre in einer Anweisung). */
async function zaehleFehlversuch(): Promise<PinSperre> {
  const { data, error } = await createAdminClient().rpc("wa_pin_fehlversuch", {
    p_max: MAX_FEHLVERSUCHE,
    p_sperre: `${SPERRE_MS / 60_000} minutes`,
  });
  if (error) throw new Error(`Fehlversuch nicht gezählt: ${error.message}`);
  const w = (data ?? {}) as Partial<PinSperre>;
  return { fehlversuche: Number(w.fehlversuche ?? 0), gesperrt_bis: w.gesperrt_bis ?? null };
}

async function setzeSperreZurueck(): Promise<void> {
  const { error } = await createAdminClient()
    .from("wa_einstellungen")
    .upsert(
      { key: SPERR_KEY, wert: { fehlversuche: 0, gesperrt_bis: null }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw new Error(`PIN-Sperre nicht zurückgesetzt: ${error.message}`);
}

export async function istFreigeschaltet(): Promise<boolean> {
  const key = schluessel();
  if (!key) return false;
  const wert = (await cookies()).get(COOKIE)?.value;
  const [ablaufText, sig] = (wert ?? "").split(".");
  const ablauf = Number(ablaufText);
  if (!sig || !Number.isFinite(ablauf) || ablauf * 1000 < Date.now()) return false;
  return gleich(sig, signiere(ablauf, key));
}

/** PIN prüfen und bei Erfolg das Cookie setzen (nur in Server Actions aufrufen). */
export async function schalteFrei(pin: string): Promise<{ ok: boolean; meldung: string }> {
  const zustand = adminPinZustand();
  if (zustand === "fehlt") return { ok: false, meldung: "WHATSAPP_ADMIN_PIN ist nicht gesetzt." };
  if (zustand === "zu_kurz") return { ok: false, meldung: "PIN zu kurz – bitte in Vercel ändern (mind. 10 Zeichen)." };
  const key = schluessel();
  const soll = sollPin();
  if (!key || !soll) return { ok: false, meldung: "PIN nicht nutzbar." };

  // Fail-closed: ohne lesbaren/schreibbaren Fehlversuchs-Zähler keine PIN-Prüfung
  let sperre: PinSperre;
  try {
    sperre = await ladeSperre();
  } catch {
    return { ok: false, meldung: "PIN-Prüfung derzeit nicht möglich (Datenbank) – bitte später erneut versuchen." };
  }
  if (sperre.gesperrt_bis && new Date(sperre.gesperrt_bis).getTime() > Date.now()) {
    return { ok: false, meldung: "Zu viele Fehlversuche – Freischaltung für 15 Minuten gesperrt." };
  }

  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  if (!gleich(hash(pin.trim()), hash(soll))) {
    let stand: PinSperre;
    try {
      stand = await zaehleFehlversuch();
    } catch {
      return { ok: false, meldung: "PIN-Prüfung derzeit nicht möglich (Datenbank) – bitte später erneut versuchen." };
    }
    // Raten bremsen
    await new Promise((r) => setTimeout(r, 1500));
    return {
      ok: false,
      meldung: stand.gesperrt_bis
        ? "PIN falsch – zu viele Fehlversuche, 15 Minuten gesperrt."
        : `PIN falsch (${stand.fehlversuche} von ${MAX_FEHLVERSUCHE} Versuchen).`,
    };
  }

  if (sperre.fehlversuche > 0 || sperre.gesperrt_bis) {
    try {
      await setzeSperreZurueck();
    } catch {
      return { ok: false, meldung: "PIN-Prüfung derzeit nicht möglich (Datenbank) – bitte später erneut versuchen." };
    }
  }
  const ablauf = Math.floor(Date.now() / 1000) + GUELTIG_S;
  (await cookies()).set(COOKIE, `${ablauf}.${signiere(ablauf, key)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: COOKIE_PFAD,
    maxAge: GUELTIG_S,
  });
  return { ok: true, meldung: "Freigeschaltet (12 Stunden)." };
}

export async function sperre(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: COOKIE_PFAD });
}
