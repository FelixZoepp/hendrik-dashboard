/**
 * Pipeline „Setter-Closer Hoffmann Solutions“ in Close: Status-IDs, Rangfolge, Lead-Status.
 * Gemeinsam genutzt von der Close-Automatik (api/webhooks/close) und dem WhatsApp-Terminbot
 * (Calendly-Buchungen). Bewusst ohne Imports, damit das node-Prüfskript die Datei laden kann.
 */

/** Opportunity-Feld „Termin am“ */
export const OPP_TERMIN_AM_FELD = "custom.cf_I3BNybAZ6KvH3SHWjaWOo2tufWH0ylIn29vMnIU07qY";

export const OPP = {
  settingTerminiert: "stat_4p97QFLGWcJTiOLz4s1bYtWKBVQR50XaQpHUdfhe8UC",
  settingNoShow: "stat_pGAeTxZ2rkNIzksWsLHKoHJdllKUCWUuqLs4dH9edNZ",
  settingFollowUp: "stat_S4XYNlf3MhHEKnvjbiCeUYJg52iX6dFWkaWuUoFg8xE",
  closingTerminiert: "stat_KSyJfnSIxwTUu4e9gJhhjoI7zn6b2pTALKpD4MIL3q0",
  closingNoShow: "stat_dXLGmLsbyoD77vFRmaY0dDm5jPd3MMxwz291MF6gxUK",
  closingFollowUp: "stat_77oJcfWYHn8JEIIS1mvBtQdCZn1ibDtpOgI6XX1Q37Y",
  cc2Vereinbart: "stat_a8IP5oWXJtjSAsFFlZyQfmBBTgBPpktTTaX67IJe7c9",
  angebotVersendet: "stat_gtUPpOqoO1rgiamIUWB16xljZO3RWyJy6u4wFUL0ThO",
  verkauft: "stat_E7Pi9IXxDFN2ZVi4JSjMX2lVAunuiMhPziMM6rC4apn",
  verloren: "stat_7ZzzWHiE2qep8OKcGjELV6fGIIrpWgZbdYOY7tzFxdZ",
};

// Rangfolge der Setter-Closer-Pipeline — Opportunities laufen nur vorwärts
export const RANG: Record<string, number> = {
  [OPP.settingTerminiert]: 1,
  [OPP.settingNoShow]: 1,
  [OPP.settingFollowUp]: 1,
  [OPP.closingTerminiert]: 2,
  [OPP.closingNoShow]: 2,
  [OPP.closingFollowUp]: 2,
  [OPP.cc2Vereinbart]: 3,
  [OPP.angebotVersendet]: 4,
  [OPP.verkauft]: 5,
  [OPP.verloren]: 5,
};
export const ABGESCHLOSSEN = new Set([OPP.verkauft, OPP.verloren]);

export const LEAD = {
  interessiert: "stat_Aovea3A7R0A8m2vWAJF2sS7s44TM5VNldFh07t0wwqP",
  keinInteresse: "stat_1gD0nIgiioj0gVbsBH8DSQtEZuppHg54A4PIOCGtwtw",
  followUp: "stat_Zkys2rUO8HpYAUoSedsrAKBmvhl2yjyM37R8hPNoDm0",
  setting: "stat_ityX5rSG4nUeLnyzHXmPY3pu1oGLCh18lTG2xeGlHzu",
  closing: "stat_YEoiWledPo9QiondDWkVs68QBvm7NCc7UUrsge6EQCM",
  disqualifiziert: "stat_d8wp87FelzfIADu2p4nYIE1YCXsvgtpEED6osK8PQTH",
  unqualifiziert: "stat_5sAl7XILLyqYTCakLOosngsJy9dDJMaWLVhvqZYwzmC",
  kunde: "stat_X6PkUBGnxmMRurKXzybtmb3p6pGqWV7KE5RNuCWcpvV",
};

export interface PipelineOpp {
  id: string;
  status_id: string;
  date_updated: string;
}

/** Opportunities der Pipeline und die aktive (nicht abgeschlossen, zuletzt bearbeitet). */
export function pipelineStand(opportunities: PipelineOpp[]): { pipelineOpps: PipelineOpp[]; aktiv: PipelineOpp | undefined } {
  const pipelineOpps = opportunities.filter((o) => o.status_id in RANG);
  // Bei mehreren laufenden Deals nur den zuletzt bearbeiteten bewegen
  const aktiv = pipelineOpps
    .filter((o) => !ABGESCHLOSSEN.has(o.status_id))
    .sort((a, b) => b.date_updated.localeCompare(a.date_updated))[0];
  return { pipelineOpps, aktiv };
}

/** Ziel-Status liegt nicht hinter dem aktuellen (gleicher Rang ist erlaubt, z. B. No-Show → Terminiert). */
export function darfVorwaerts(ziel: string, aktuell: string): boolean {
  return !(RANG[ziel] < RANG[aktuell]);
}

export type BuchungsArt = "erstgespraech" | "strategie";

export type PipelineSchritt =
  | { opp: "anlegen"; status: string; leadStatus: string | null }
  | { opp: "verschieben"; id: string; status: string; leadStatus: string | null }
  | { opp: "schon_weiter"; id: string; leadStatus: null };

/**
 * Calendly-Buchung → Pipeline: Erstgespräch = Setting terminiert, Strategiegespräch = Closing terminiert.
 * - Keine aktive Opportunity → anlegen
 * - Aktive Opportunity → nur vorwärts bewegen (sonst unverändert lassen, auch kein Lead-Status)
 * - Lead-Status Setting/Closing, außer der Lead ist schon Kunde
 */
export function pipelineFuerBuchung(
  lead: { status_id: string | null | undefined; opportunities: PipelineOpp[] },
  art: BuchungsArt,
): PipelineSchritt {
  const status = art === "strategie" ? OPP.closingTerminiert : OPP.settingTerminiert;
  const leadZiel = art === "strategie" ? LEAD.closing : LEAD.setting;
  const leadStatus = lead.status_id === LEAD.kunde || lead.status_id === leadZiel ? null : leadZiel;
  const { aktiv } = pipelineStand(lead.opportunities);
  if (!aktiv) return { opp: "anlegen", status, leadStatus };
  if (!darfVorwaerts(status, aktiv.status_id)) return { opp: "schon_weiter", id: aktiv.id, leadStatus: null };
  return { opp: "verschieben", id: aktiv.id, status, leadStatus };
}
