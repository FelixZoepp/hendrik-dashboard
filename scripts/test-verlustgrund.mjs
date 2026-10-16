// Prüft die reine Logik der Verlustgrund-Automatik (Protokoll → Grund, Aufgabe, Dedupe, Sync-Filter).
// Aufruf: node scripts/test-verlustgrund.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import {
  alsCustomKey,
  aufgabenText,
  berlinerTag,
  hatOffeneAufgabe,
  istGrundGesetzt,
  offeneVerlusteOhneGrund,
  PROTOKOLL_TYP,
  schonErinnert,
  setzeMarker,
  VERLOREN_REGELN,
  verlustAusProtokoll,
  VERLUSTGRUENDE,
} from "../src/lib/verlustgrund/logik.ts";
import { OPP } from "../src/lib/close-pipeline.ts";

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

const S = VERLOREN_REGELN[PROTOKOLL_TYP.setting].feld;
const C = VERLOREN_REGELN[PROTOKOLL_TYP.closing].feld;
const GF = { setting: "custom.cf_setgrund", closing: "custom.cf_closegrund" };
const setting = (x) => ({ custom_activity_type_id: PROTOKOLL_TYP.setting, lead_id: "lead_1", ...x });
const closing = (x) => ({ custom_activity_type_id: PROTOKOLL_TYP.closing, lead_id: "lead_1", ...x });

console.log("Gründe");
test("10 Gründe, eindeutig, Sonstiges zuletzt", () => {
  assert.equal(VERLUSTGRUENDE.length, 10);
  assert.equal(new Set(VERLUSTGRUENDE).size, 10);
  assert.equal(VERLUSTGRUENDE.at(-1), "Sonstiges (Notiz)");
});
test("Feld-Keys normalisieren", () => {
  assert.equal(alsCustomKey("cf_abc"), "custom.cf_abc");
  assert.equal(alsCustomKey(" custom.cf_abc "), "custom.cf_abc");
  assert.equal(alsCustomKey(""), null);
  assert.equal(alsCustomKey(null), null);
});

console.log("Protokoll → Verlust/Grund");
test("Setting „Nicht qualifiziert“ + Grund", () => {
  assert.deepEqual(verlustAusProtokoll(setting({ [S]: "Nicht qualifiziert", [GF.setting]: "Kein Budget / nicht liquide" }), GF), {
    verloren: true,
    grund: "Kein Budget / nicht liquide",
  });
});
test("Setting „Disqualifiziert“ + Grund", () => {
  assert.equal(verlustAusProtokoll(setting({ [S]: "Disqualifiziert", [GF.setting]: "Sprachbarriere" }), GF).grund, "Sprachbarriere");
});
test("Setting verloren ohne Grund → Aufgabe nötig", () => {
  assert.deepEqual(verlustAusProtokoll(setting({ [S]: "Nicht qualifiziert" }), GF), { verloren: true, grund: null });
  assert.deepEqual(verlustAusProtokoll(setting({ [S]: "Nicht qualifiziert", [GF.setting]: "" }), GF), { verloren: true, grund: null });
});
test("Unbekannter Grund zählt nicht", () => {
  assert.equal(verlustAusProtokoll(setting({ [S]: "Disqualifiziert", [GF.setting]: "Erfunden" }), GF).grund, null);
});
test("Grund-Feld noch nicht angelegt → verloren, ohne Grund", () => {
  assert.deepEqual(verlustAusProtokoll(setting({ [S]: "Nicht qualifiziert", [GF.setting]: "Sprachbarriere" }), { setting: null, closing: null }), {
    verloren: true,
    grund: null,
  });
});
test("Setting nicht verloren (Closing gelegt / No-Show)", () => {
  assert.equal(verlustAusProtokoll(setting({ [S]: "Closing gelegt am:", [GF.setting]: "Sprachbarriere" }), GF).verloren, false);
  assert.equal(verlustAusProtokoll(setting({ [S]: "No-Show" }), GF).verloren, false);
  assert.equal(verlustAusProtokoll(setting({}), GF).verloren, false);
});
test("Closing „Unqualifiziert“ + Grund aus dem Closing-Feld (nicht dem Setting-Feld)", () => {
  assert.equal(verlustAusProtokoll(closing({ [C]: "Unqualifiziert", [GF.closing]: "Entscheider fehlt" }), GF).grund, "Entscheider fehlt");
  assert.deepEqual(verlustAusProtokoll(closing({ [C]: "Unqualifiziert", [GF.setting]: "Entscheider fehlt" }), GF), {
    verloren: true,
    grund: null,
  });
});
test("Closing „Abgeschlossen“ und fremder Protokoll-Typ", () => {
  assert.equal(verlustAusProtokoll(closing({ [C]: "Abgeschlossen" }), GF).verloren, false);
  assert.equal(verlustAusProtokoll({ custom_activity_type_id: "actitype_x", [S]: "Disqualifiziert" }, GF).verloren, false);
});
test("Mehrfachauswahl: erster Wert", () => {
  assert.equal(verlustAusProtokoll(setting({ [S]: "Disqualifiziert", [GF.setting]: ["Mindset / nicht beratbar"] }), GF).grund, "Mindset / nicht beratbar");
});

console.log("Grund gesetzt?");
test("istGrundGesetzt", () => {
  assert.equal(istGrundGesetzt(undefined), false);
  assert.equal(istGrundGesetzt(null), false);
  assert.equal(istGrundGesetzt(""), false);
  assert.equal(istGrundGesetzt("  "), false);
  assert.equal(istGrundGesetzt([]), false);
  assert.equal(istGrundGesetzt("Sprachbarriere"), true);
  assert.equal(istGrundGesetzt(["Sprachbarriere"]), true);
});

console.log("Aufgabe + Dedupe");
test("Aufgabentext", () => {
  assert.equal(
    aufgabenText("Tischlerei Muster"),
    "❓ Verlustgrund eintragen (Tischlerei Muster): Opportunity öffnen → Feld „Verlustgrund“ auswählen – ohne Grund wissen wir nicht, woran wir verlieren",
  );
  assert.ok(aufgabenText(null).includes("(Deal)"));
});
test("offene Aufgabe erkennen", () => {
  assert.equal(hatOffeneAufgabe([{ text: aufgabenText("X"), is_complete: false }]), true);
  assert.equal(hatOffeneAufgabe([{ text: aufgabenText("X"), is_complete: true }]), false);
  assert.equal(hatOffeneAufgabe([{ text: "Rückruf: Lead ist interessiert" }]), false);
});
test("Berliner Tag", () => {
  assert.equal(berlinerTag(new Date("2026-10-16T22:30:00Z")), "2026-10-17");
  assert.equal(berlinerTag(new Date("2026-10-16T21:30:00Z")), "2026-10-16");
});
test("pro Opportunity und Tag einmal, alte Marker fallen raus", () => {
  const m = setzeMarker({ alt: "2026-09-01", frisch: "2026-10-10" }, "oppo_1", "2026-10-16");
  assert.deepEqual(m, { frisch: "2026-10-10", oppo_1: "2026-10-16" });
  assert.equal(schonErinnert(m, "oppo_1", "2026-10-16"), true);
  assert.equal(schonErinnert(m, "oppo_1", "2026-10-17"), false);
  assert.equal(schonErinnert(m, "oppo_2", "2026-10-16"), false);
});

console.log("Sync: manuell verloren ohne Grund");
const jetzt = new Date("2026-10-16T10:00:00Z");
const vor = (min) => new Date(jetzt.getTime() - min * 60_000).toISOString();
const F = "custom.cf_verlust";
const opp = (id, x) => ({ id, status_type: "lost", status_id: OPP.verloren, date_updated: vor(60), ...x });
test("Filter: Karenz 30 Min., Fenster 24 Std., Feld leer, Status lost, Marker", () => {
  const opps = [
    opp("a"), // ✓
    opp("b", { date_updated: vor(10) }), // zu frisch
    opp("c", { date_updated: vor(25 * 60) }), // zu alt
    opp("d", { [F]: "Sprachbarriere" }), // Grund da
    opp("e", { status_type: "active" }), // nicht verloren
    opp("f", { status_type: "won" }),
    opp("g"), // heute schon erinnert
    opp("h", { [F]: "" }), // leer ✓
    opp("i", { date_updated: undefined }),
  ];
  const r = offeneVerlusteOhneGrund(opps, F, { g: "2026-10-16" }, jetzt).map((o) => o.id);
  assert.deepEqual(r, ["a", "h"]);
});
test("Marker von gestern blockiert nicht", () => {
  assert.deepEqual(offeneVerlusteOhneGrund([opp("g")], F, { g: "2026-10-15" }, jetzt).map((o) => o.id), ["g"]);
});
test("Regeln passen zur Pipeline-Automatik (gleiche Feld-IDs wie im Webhook)", () => {
  assert.equal(PROTOKOLL_TYP.setting, "actitype_41UXYctoK8pqnPD2TvTGoO");
  assert.equal(PROTOKOLL_TYP.closing, "actitype_71sdCTlSLsK8bWiC802Bn8");
  assert.equal(S, "custom.cf_6Kt9RVMkQiuDOXBiiTRrKg8DTwvoQn8EEBCXmaTykGZ");
  assert.equal(C, "custom.cf_9vkQK8YANMMZ3lyt0aAZbAnkAxYoB15WwM5sTyr3veM");
});

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`);
process.exit(fehler ? 1 : 0);
