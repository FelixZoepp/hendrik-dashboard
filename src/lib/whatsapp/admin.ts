import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

/**
 * Schutz der Bot-Schalter im Dashboard (Auth ist im Projekt deaktiviert):
 * Eingabe von WHATSAPP_ADMIN_PIN → httpOnly-Cookie mit Ablaufzeit + HMAC (nicht der PIN selbst).
 */

const COOKIE = "wa_admin";
const GUELTIG_S = 12 * 60 * 60;

function schluessel(): Buffer | null {
  const pin = process.env.WHATSAPP_ADMIN_PIN;
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

export function adminPinGesetzt(): boolean {
  return !!process.env.WHATSAPP_ADMIN_PIN;
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
export async function schalteFrei(pin: string): Promise<boolean> {
  const key = schluessel();
  const soll = process.env.WHATSAPP_ADMIN_PIN;
  if (!key || !soll) return false;
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  if (!gleich(hash(pin.trim()), hash(soll))) {
    // Raten bremsen
    await new Promise((r) => setTimeout(r, 1500));
    return false;
  }
  const ablauf = Math.floor(Date.now() / 1000) + GUELTIG_S;
  (await cookies()).set(COOKIE, `${ablauf}.${signiere(ablauf, key)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/sales/whatsapp",
    maxAge: GUELTIG_S,
  });
  return true;
}

export async function sperre(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: "/sales/whatsapp" });
}
