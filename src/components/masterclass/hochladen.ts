import { createClient } from "@/lib/supabase/client";

type Vorbereitung = { readonly pfad: string; readonly token: string } | { readonly fehler: string };

/**
 * Datei direkt aus dem Browser in den Storage-Bucket „masterclass“ laden.
 * Der Server (Team-Prüfung) erzeugt vorher eine signierte Upload-URL — so gibt es kein
 * Größenlimit der Server Actions und keine Storage-Schreibrechte im Browser.
 */
export async function hochladen(
  vorbereiten: (dateiname: string) => Promise<Vorbereitung>,
  datei: File,
): Promise<{ pfad: string } | { fehler: string }> {
  if (datei.size > 100 * 1024 * 1024) return { fehler: "Datei ist größer als 100 MB." };
  const v = await vorbereiten(datei.name);
  if ("fehler" in v) return { fehler: v.fehler };
  const { error } = await createClient()
    .storage.from("masterclass")
    .uploadToSignedUrl(v.pfad, v.token, datei, { contentType: datei.type || undefined });
  if (error) return { fehler: `Upload fehlgeschlagen: ${error.message}` };
  return { pfad: v.pfad };
}
