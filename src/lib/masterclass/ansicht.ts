import type { SupabaseClient } from "@supabase/supabase-js";
import type { LektionAnsichtProps } from "@/components/masterclass/lektion-ansicht";
import { anhangLinks, ladeAufgaben } from "./daten";
import { type Lektion, type Modul, type Sperre, bereinigeHtml, lektionenVon, nachbarn, nachKapiteln } from "./logik";

/** Daten für <LektionAnsicht> — gemeinsam für Kundenseite und Editor-Vorschau. */
export async function lektionAnsichtDaten(
  db: SupabaseClient,
  e: {
    lektion: Lektion;
    modul: Modul;
    /** Alle Lektionen, die in dieser Ansicht sichtbar sind */
    lektionen: Lektion[];
    geordnet: Lektion[];
    erledigt: ReadonlySet<string>;
    sperren?: ReadonlyMap<string, Sperre>;
    erledigteAufgaben?: (taskIds: string[]) => Promise<Set<string>>;
  },
): Promise<Omit<LektionAnsichtProps, "modus" | "lektionLink" | "zurueck" | "speichereLektion" | "speichereAufgabe">> {
  const [aufgaben, anhaenge] = await Promise.all([ladeAufgaben(db, [e.lektion.id]), anhangLinks(db, e.lektion.anhaenge)]);
  const fertigeAufgaben = e.erledigteAufgaben ? await e.erledigteAufgaben(aufgaben.map((a) => a.id)) : new Set<string>();
  const offen = (l: Lektion | null) => (l && !e.sperren?.get(l.id)?.gesperrt ? { id: l.id, titel: l.titel } : null);
  const { vorher, nachher } = nachbarn(e.geordnet, e.lektion.id);

  return {
    lektion: {
      id: e.lektion.id,
      titel: e.lektion.titel,
      beschreibung: e.lektion.beschreibung,
      typ: e.lektion.typ,
      video_url: e.lektion.video_url,
      html: e.lektion.content_html ? bereinigeHtml(e.lektion.content_html) || null : null,
      dauer: e.lektion.dauer,
      zeitmarken: e.lektion.zeitmarken,
    },
    modul: { id: e.modul.id, titel: e.modul.titel },
    seitenleiste: nachKapiteln(lektionenVon(e.modul.id, e.lektionen)).map((g) => ({
      kapitel: g.kapitel,
      lektionen: g.lektionen.map((l) => ({
        id: l.id,
        titel: l.titel,
        typ: l.typ,
        dauer: l.dauer,
        erledigt: e.erledigt.has(l.id),
        gesperrt: !!e.sperren?.get(l.id)?.gesperrt,
      })),
    })),
    anhaenge,
    aufgaben: aufgaben.map((a) => ({ id: a.id, titel: a.titel, beschreibung: a.beschreibung, erledigt: fertigeAufgaben.has(a.id) })),
    erledigt: e.erledigt.has(e.lektion.id),
    vorher: offen(vorher),
    nachher: offen(nachher),
  };
}
