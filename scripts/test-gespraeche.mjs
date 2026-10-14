// Prüft die reinen Funktionen der Gesprächsanalyse (Sync-Filter, Phase, Wichtigkeit/Upload-Reihenfolge,
// Fireflies-Budget, Analyse-Schema, Einwand-Ranking, Abbruch-Verteilung, Opener-Vergleich).
// Aufruf: node scripts/test-gespraeche.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import {
  abbruchBucket,
  abbruchGruende,
  abbruchVerteilung,
  ANALYSE_JSON_SCHEMA,
  berlinTag,
  einwandRanking,
  endPhase,
  freieUploads,
  hookQuote,
  istAuswertbar,
  istRateLimit,
  istWichtig,
  kennzahlen,
  normalisiere,
  openerVergleich,
  pruefeAnalyse,
  transkriptText,
  uploadPrioritaet,
  vorlaeufigePhase,
  zahlAusEnv,
  zuAltFuerUpload,
} from "../src/lib/gespraeche/logik.ts";
import { HENDRIK_ID, NAMEN, OPENER_IDS, rolleVon } from "../src/lib/close-team.ts";

let ok = 0;
let fehler = 0;
function test(name, fn) {
  try {
    fn();
    ok++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fehler++;
    console.log(`  ✗ ${name}\n    ${err.message.split("\n").join("\n    ")}`);
  }
}

const MIN = 60_000;
const t0 = new Date("2026-10-14T10:00:00Z"); // 12:00 Berlin

console.log("Close-Team");
test("Rollen: Opener, Hendrik, sonst", () => {
  assert.equal(rolleVon(OPENER_IDS[1]), "opener");
  assert.equal(rolleVon(HENDRIK_ID), "hendrik");
  assert.equal(rolleVon("user_x"), "sonst");
  assert.equal(rolleVon(null), "sonst");
  assert.equal(NAMEN[OPENER_IDS[1]], "Renney");
});

console.log("Sync-Filter");
const call = (x = {}) => ({
  id: "acti_1", lead_id: "lead_1", user_id: OPENER_IDS[0], direction: "outbound", disposition: "answered",
  duration: 40, has_recording: true, recording_url: "https://api.close.com/call/acti_1/recording/", date_created: t0.toISOString(), ...x,
});
test("angenommen + Aufnahme + ≥ 15 s, ein- und ausgehend", () => {
  assert.equal(istAuswertbar(call()), true);
  assert.equal(istAuswertbar(call({ direction: "inbound" })), true);
  assert.equal(istAuswertbar(call({ duration: 15 })), true);
  assert.equal(istAuswertbar(call({ duration: 14 })), false);
  assert.equal(istAuswertbar(call({ disposition: "no-answer" })), false);
  assert.equal(istAuswertbar(call({ recording_url: null })), false);
  assert.equal(istAuswertbar(call({ has_recording: false })), false);
});

console.log("Phase vorab");
const leer = { termine: [], protokolle: [] };
test("Opener → opening, Unbekannt → sonstiges", () => {
  assert.equal(vorlaeufigePhase({ rolle: "opener", zeit: t0, ...leer }).phase, "opening");
  assert.equal(vorlaeufigePhase({ rolle: "sonst", zeit: t0, ...leer }).phase, "sonstiges");
  assert.equal(vorlaeufigePhase({ rolle: "hendrik", zeit: t0, ...leer }).phase, "sonstiges");
});
test("Hendrik: Termin ±90 Min., nächstgelegener gewinnt", () => {
  const termine = [
    { art: "setting", start: new Date(t0.getTime() - 80 * MIN) },
    { art: "closing", start: new Date(t0.getTime() + 10 * MIN) },
  ];
  assert.equal(vorlaeufigePhase({ rolle: "hendrik", zeit: t0, termine, protokolle: [] }).phase, "closing");
  const weit = [{ art: "closing", start: new Date(t0.getTime() + 91 * MIN) }];
  assert.equal(vorlaeufigePhase({ rolle: "hendrik", zeit: t0, termine: weit, protokolle: [] }).phase, "sonstiges");
});
test("Hendrik: Protokoll am selben Berliner Tag", () => {
  const protokolle = [{ art: "setting", datum: new Date(t0.getTime() + 4 * 60 * MIN) }];
  assert.equal(vorlaeufigePhase({ rolle: "hendrik", zeit: t0, termine: [], protokolle }).phase, "setting");
  // 23:30 Berlin am Vortag zählt nicht
  const vortag = [{ art: "closing", datum: new Date("2026-10-13T21:30:00Z") }];
  assert.equal(vorlaeufigePhase({ rolle: "hendrik", zeit: t0, termine: [], protokolle: vortag }).phase, "sonstiges");
  // Termin hat Vorrang vor Protokoll
  const termine = [{ art: "closing", start: t0 }];
  assert.equal(vorlaeufigePhase({ rolle: "hendrik", zeit: t0, termine, protokolle }).phase, "closing");
});
test("berlinTag über Mitternacht", () => {
  assert.equal(berlinTag(new Date("2026-10-13T22:30:00Z")), "2026-10-14");
  assert.equal(berlinTag(new Date("2026-10-13T21:30:00Z")), "2026-10-13");
});

console.log("Wichtigkeit und Upload-Reihenfolge");
test("istWichtig: Setting/Closing immer, Opening ab Mindestdauer, Sonstiges nie", () => {
  assert.equal(istWichtig({ phase: "setting", dauer_sek: 16 }).wichtig, true);
  assert.equal(istWichtig({ phase: "closing", dauer_sek: 20 }).wichtig, true);
  assert.equal(istWichtig({ phase: "opening", dauer_sek: 600 }).wichtig, false);
  const kurz = istWichtig({ phase: "opening", dauer_sek: 59 });
  assert.equal(kurz.wichtig, false);
  assert.equal(kurz.grund, "Opening: wird nicht transkribiert");
  assert.equal(istWichtig({ phase: "sonstiges", dauer_sek: 900 }).wichtig, false);
});
test("uploadPrioritaet: Closing > Setting > Opening; Opening längste zuerst; sonst älteste zuerst", () => {
  const g = (phase, dauer_sek, datum) => ({ phase, dauer_sek, datum });
  const liste = [
    g("opening", 70, "2026-10-14T08:00:00Z"),
    g("opening", 300, "2026-10-14T09:00:00Z"),
    g("setting", 600, "2026-10-14T10:00:00Z"),
    g("closing", 1800, "2026-10-14T11:00:00Z"),
    g("setting", 400, "2026-10-13T10:00:00Z"),
  ].sort(uploadPrioritaet);
  assert.deepEqual(liste.map((x) => `${x.phase}:${x.dauer_sek}`), ["closing:1800", "setting:400", "setting:600", "opening:300", "opening:70"]);
});
test("zuAltFuerUpload: mehr als 3 Tage", () => {
  assert.equal(zuAltFuerUpload("2026-10-11T10:00:00Z", t0), false);
  assert.equal(zuAltFuerUpload("2026-10-11T09:59:00Z", t0), true);
});
test("zahlAusEnv", () => {
  assert.equal(zahlAusEnv(undefined, 60), 60);
  assert.equal(zahlAusEnv("90", 60), 90);
  assert.equal(zahlAusEnv("abc", 60), 60);
  assert.equal(zahlAusEnv("0", 50), 50);
});

console.log("Fireflies-Budget");
test("freieUploads reserviert Abrufe und eine Suche", () => {
  assert.equal(freieUploads(50, 0), 24);
  assert.equal(freieUploads(50, 10), 19);
  assert.equal(freieUploads(3, 0), 1);
  assert.equal(freieUploads(2, 0), 0);
  assert.equal(freieUploads(5, 10), 0);
});
test("istRateLimit", () => {
  assert.equal(istRateLimit(429, null), true);
  assert.equal(istRateLimit(200, "Too many requests. Please retry after 1h"), true);
  assert.equal(istRateLimit(200, "too_many_requests"), true);
  assert.equal(istRateLimit(400, "Invalid argument"), false);
});

console.log("Transkript");
test("transkriptText mit Zeitmarken", () => {
  const text = transkriptText([{ speaker_name: "Speaker 1", text: "Hallo", start_time: 65.4 }]);
  assert.equal(text, "[1:05 | 65s] Speaker 1: Hallo");
  assert.ok(transkriptText([{ speaker_name: null, text: "x".repeat(50), start_time: 0 }], 20).endsWith("[… gekürzt]"));
});

console.log("Analyse-Schema");
const analyse = (x = {}) => ({
  phase: "opening",
  zusammenfassung: "Kurz.",
  ergebnis: "kein Interesse",
  entscheider_erreicht: true,
  termin_vereinbart: false,
  einwaende: [{ kategorie: "Schon Agentur", zitat: "Wir haben schon eine Agentur.", sekunde: 12.6, reaktion: "aufgegeben", reaktion_gut: false }],
  opening: { abbruch_sekunde: 20, abbruch_grund: "schon Agentur", hook_funktioniert: false, gatekeeper: false },
  fehler: [],
  staerken: [],
  punkte: 140,
  tipp: "Nachfragen.",
  ...x,
});
test("pruefeAnalyse: JSON-Text, Punkte begrenzt, Sekunden gerundet", () => {
  const a = pruefeAnalyse(JSON.stringify(analyse()));
  assert.equal(a.punkte, 100);
  assert.equal(a.einwaende[0].sekunde, 13);
  assert.equal(pruefeAnalyse(analyse({ punkte: -3 })).punkte, 0);
});
test("pruefeAnalyse: opening nur bei Phase opening, max. 5 Fehler", () => {
  assert.equal(pruefeAnalyse(analyse({ phase: "setting" })).opening, null);
  const f = { fehler: "x", zitat: "y", sekunde: 1, besser: "z" };
  assert.equal(pruefeAnalyse(analyse({ fehler: [f, f, f, f, f, f, f] })).fehler.length, 5);
});
test("pruefeAnalyse: ungültig wirft", () => {
  assert.throws(() => pruefeAnalyse("{kein json"));
  assert.throws(() => pruefeAnalyse(analyse({ phase: "follow_up" })));
  assert.throws(() => pruefeAnalyse(analyse({ entscheider_erreicht: "ja" })));
});
test("JSON-Schema: alle Objekte additionalProperties false, alle Felder required", () => {
  const pruefe = (s, pfad) => {
    if (Array.isArray(s.anyOf)) return s.anyOf.forEach((x, i) => pruefe(x, `${pfad}|${i}`));
    if (s.type === "object") {
      assert.equal(s.additionalProperties, false, pfad);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), pfad);
      for (const [k, v] of Object.entries(s.properties)) pruefe(v, `${pfad}.${k}`);
    }
    if (s.type === "array") pruefe(s.items, `${pfad}[]`);
    assert.ok(!("minimum" in s) && !("maximum" in s), `${pfad}: min/max nicht erlaubt`);
  };
  pruefe(ANALYSE_JSON_SCHEMA, "$");
});

console.log("Auswertungen");
const zeile = (x = {}) => ({ call_id: "c", user_name: "Renney", dauer_sek: 90, phase: "opening", status: "analysiert", punkte: 50, ergebnis: pruefeAnalyse(analyse()), ...x });
const daten = [
  zeile({ call_id: "a" }),
  zeile({
    call_id: "b",
    user_name: "Opener 1",
    ergebnis: pruefeAnalyse(
      analyse({
        punkte: 80,
        einwaende: [
          { kategorie: "schon agentur.", zitat: "Haben wir.", sekunde: 5, reaktion: "nachgefragt", reaktion_gut: true },
          { kategorie: "Schon Agentur", zitat: "Doppelt", sekunde: 9, reaktion: "x", reaktion_gut: true },
          { kategorie: "keine Zeit", zitat: "Keine Zeit", sekunde: 3, reaktion: "x", reaktion_gut: false },
        ],
        opening: { abbruch_sekunde: null, abbruch_grund: null, hook_funktioniert: true, gatekeeper: true },
        termin_vereinbart: true,
      }),
    ),
  }),
  zeile({ call_id: "c", status: "uebersprungen", ergebnis: null, dauer_sek: 25, punkte: null }),
  zeile({ call_id: "d", phase: "sonstiges", ergebnis: pruefeAnalyse(analyse({ phase: "setting", entscheider_erreicht: false, punkte: 60 })) }),
];
test("endPhase: KI-Phase vor vorläufiger", () => {
  assert.equal(endPhase(daten[3]), "setting");
  assert.equal(endPhase(daten[2]), "opening");
});
test("kennzahlen", () => {
  const k = kennzahlen(daten);
  assert.equal(k.gesamt, 4);
  assert.equal(k.analysiert, 3);
  assert.equal(k.schnittPunkte, Math.round((100 + 80 + 60) / 3));
  assert.equal(k.entscheiderQuote, 2 / 3);
});
test("normalisiere", () => assert.equal(normalisiere(" „Schon  Agentur.“ "), "schon agentur"));
test("einwandRanking: zusammengeführt, je Gespräch einmal, Anteil gut", () => {
  const r = einwandRanking(daten, "opening");
  assert.equal(r[0].kategorie, "Schon Agentur");
  assert.equal(r[0].anzahl, 2);
  assert.equal(r[0].gutAnteil, 0.5);
  assert.equal(r[0].beispiel, "Wir haben schon eine Agentur.");
  assert.equal(r[1].kategorie, "Keine Zeit");
  assert.equal(einwandRanking(daten, "setting").length, 1);
  assert.equal(einwandRanking(daten, "closing").length, 0);
});
test("abbruchBucket-Grenzen", () => {
  assert.equal(abbruchBucket(9), "0–10 s");
  assert.equal(abbruchBucket(10), "10–30 s");
  assert.equal(abbruchBucket(30), "30–60 s");
  assert.equal(abbruchBucket(60), "> 60 s");
});
test("abbruchVerteilung: KI-Sekunde, sonst Dauer nicht analysierter Calls", () => {
  const v = abbruchVerteilung(daten);
  assert.equal(v.buckets["10–30 s"], 2); // a: KI 20 s, c: Dauer 25 s
  assert.equal(v.keinAbbruch, 1); // b
  assert.equal(v.buckets["0–10 s"] + v.buckets["30–60 s"] + v.buckets["> 60 s"], 0);
});
test("abbruchGruende", () => assert.deepEqual(abbruchGruende(daten), [{ grund: "Schon Agentur", anzahl: 1 }]));
test("openerVergleich + hookQuote", () => {
  const o = openerVergleich(daten);
  const renney = o.find((x) => x.name === "Renney");
  assert.equal(renney.calls, 2);
  assert.equal(renney.analysiert, 1);
  assert.equal(renney.hookQuote, 0);
  const o1 = o.find((x) => x.name === "Opener 1");
  assert.equal(o1.terminQuote, 1);
  assert.equal(o1.gatekeeperQuote, 1);
  assert.equal(hookQuote(daten), 0.5);
});

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`);
process.exit(fehler ? 1 : 0);
