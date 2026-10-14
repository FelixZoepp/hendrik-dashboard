import { createHmac, timingSafeEqual } from "crypto";

/** Signatur „sha256=<hex>“ bzw. „<hex>“ (Fireflies-Webhook, Header x-hub-signature) prüfen */
export function signaturOk(roh: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const hex = createHmac("sha256", secret).update(roh).digest("hex");
  const ist = header.trim();
  const soll = ist.startsWith("sha256=") ? `sha256=${hex}` : hex;
  const a = Buffer.from(ist);
  const b = Buffer.from(soll);
  return a.length === b.length && timingSafeEqual(a, b);
}
