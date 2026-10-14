/**
 * Close-Benutzer und Gesprächsprotokoll-Typen von Hoffmann Solutions — reine Konstanten ohne Imports
 * (wird von scripts/test-gespraeche.mjs direkt mit node geprüft).
 * Opener rufen kalt an (Opening), Setting und Closing führt Hendrik Hoffmann.
 */

export const HENDRIK_ID = "user_AKQijtNFeJVgnXsqb2Lfpc9VzIpV775r6qDSnLuZYzp";

export const OPENER_IDS = [
  "user_jg9rTIVCxTBXUIsbatPhujMADNLR5cj7bHZGNlhg9mC", // Opener 1
  "user_8aTaFHt8ibP9z2u36XGGebbMVGJpqKcaUgpV78UMAwl", // Opener 2 (Renney)
  "user_s3SCQuYijLchWgQBhJSsKH58DfsMcABDptmhto3UAXz", // Opener 3
] as const;

/** Anzeigenamen für Close-Benutzer ohne (sinnvoll) gepflegten Namen */
export const NAMEN: Record<string, string> = {
  user_8aTaFHt8ibP9z2u36XGGebbMVGJpqKcaUgpV78UMAwl: "Renney",
};

/** Close Custom Activities „Gesprächsprotokoll“ */
export const PROTOKOLL = {
  coldCall: "actitype_6Ni7VfN6jGxhWfQEYLkEdK",
  setting: "actitype_41UXYctoK8pqnPD2TvTGoO",
  closing: "actitype_71sdCTlSLsK8bWiC802Bn8",
} as const;

export type Rolle = "opener" | "hendrik" | "sonst";

export function rolleVon(userId: string | null | undefined): Rolle {
  if (!userId) return "sonst";
  if (userId === HENDRIK_ID) return "hendrik";
  return (OPENER_IDS as readonly string[]).includes(userId) ? "opener" : "sonst";
}
