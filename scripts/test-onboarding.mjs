// Prüft die reine Onboarding-Logik („Dein Start in der Cloud“): Schritte, Fortschritt, Knöpfe, Kalender-Stand.
// Aufruf: node scripts/test-onboarding.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import { LEERE_DATEN, kalenderStandAus, onboardingSchritte, onboardingStand } from "../src/lib/onboarding/logik.ts";

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

const ALLES = {
  afterClose: true,
  zugaenge: true,
  kalender: "verbunden",
  anfragen: 3,
  bearbeitet: true,
  offeneAnfrageId: null,
  lektion: true,
};
const schritt = (stand, id) => stand.schritte.find((s) => s.id === id);

console.log("Schritte");
test("genau 6 Schritte in fester Reihenfolge", () => {
  assert.deepEqual(
    onboardingSchritte(LEERE_DATEN).map((s) => s.id),
    ["after_close", "zugaenge", "kalender", "anfrage", "bearbeitet", "lektion"],
  );
});
test("neuer Kunde: 0/6, 0 %, nicht fertig, Als Nächstes = Startformular", () => {
  const s = onboardingStand(LEERE_DATEN);
  assert.equal(s.erledigt, 0);
  assert.equal(s.gesamt, 6);
  assert.equal(s.prozent, 0);
  assert.equal(s.fertig, false);
  assert.equal(s.naechster?.id, "after_close");
});
test("alles erledigt: 6/6, 100 %, fertig, kein nächster Schritt, keine Knöpfe", () => {
  const s = onboardingStand(ALLES);
  assert.equal(s.erledigt, 6);
  assert.equal(s.prozent, 100);
  assert.equal(s.fertig, true);
  assert.equal(s.naechster, null);
  assert.ok(s.schritte.every((x) => x.href === null && x.knopf === null));
});
test("4 von 6 → 67 %", () => {
  const s = onboardingStand({ ...ALLES, kalender: "kein_link", lektion: false });
  assert.equal(s.erledigt, 4);
  assert.equal(s.prozent, 67);
  assert.equal(s.naechster?.id, "kalender");
});

console.log("Knöpfe");
test("offene Formulare verlinken auf /forms/…", () => {
  const s = onboardingStand(LEERE_DATEN);
  assert.equal(schritt(s, "after_close").href, "/forms/after-close");
  assert.equal(schritt(s, "zugaenge").href, "/forms/zugaenge");
  assert.equal(schritt(s, "lektion").href, "/akademie");
  assert.equal(schritt(s, "kalender").href, "/kalender");
});
test("ohne Anfrage: „bearbeiten“ hat keinen Knopf, Anfrage-Schritt zeigt Kampagne", () => {
  const s = onboardingStand(LEERE_DATEN);
  assert.equal(schritt(s, "bearbeitet").href, null);
  assert.equal(schritt(s, "anfrage").href, "/kampagne");
});
test("Anfrage da, noch nicht bearbeitet → Knopf zur ersten offenen Anfrage", () => {
  const s = onboardingStand({ ...LEERE_DATEN, anfragen: 2, offeneAnfrageId: "abc" });
  assert.equal(schritt(s, "anfrage").erledigt, true);
  assert.equal(schritt(s, "bearbeitet").href, "/leads/abc");
  assert.match(schritt(s, "anfrage").hinweis, /2 Anfragen/);
});
test("Anfrage da, keine offene Id → /leads", () => {
  const s = onboardingStand({ ...LEERE_DATEN, anfragen: 1 });
  assert.equal(schritt(s, "bearbeitet").href, "/leads");
  assert.match(schritt(s, "anfrage").hinweis, /1 Anfrage eingegangen/);
});
test("„bearbeitet“ ohne Anfrage zählt nicht (Daten gerade ziehen)", () => {
  const s = onboardingStand({ ...LEERE_DATEN, bearbeitet: true, anfragen: 0 });
  assert.equal(schritt(s, "bearbeitet").erledigt, false);
});

console.log("Kalender");
test("Stand aus Zeile: keine Zeile / kein Token / erzeugt / verbunden", () => {
  assert.equal(kalenderStandAus(null), "kein_link");
  assert.equal(kalenderStandAus({ token: null, letzter_abruf_am: "2026-10-01T10:00:00Z" }), "kein_link");
  assert.equal(kalenderStandAus({ token: "x".repeat(43), letzter_abruf_am: null }), "link_erzeugt");
  assert.equal(kalenderStandAus({ token: "x".repeat(43), letzter_abruf_am: "2026-10-01T10:00:00Z" }), "verbunden");
});
test("Link erzeugt, nie abgerufen → offen, Knopf „Weiter verbinden“", () => {
  const k = schritt(onboardingStand({ ...LEERE_DATEN, kalender: "link_erzeugt" }), "kalender");
  assert.equal(k.erledigt, false);
  assert.equal(k.knopf, "Weiter verbinden");
});
test("Migration fehlt (null) → „Wird eingerichtet“, kein Knopf, nicht als nächster Schritt", () => {
  const s = onboardingStand({ ...ALLES, kalender: null });
  const k = schritt(s, "kalender");
  assert.equal(k.erledigt, false);
  assert.equal(k.einrichtung, true);
  assert.equal(k.href, null);
  assert.equal(k.hinweis, "Wird eingerichtet.");
  assert.equal(s.fertig, false);
  assert.equal(s.naechster, null);
});

console.log(`\n${ok} ok, ${fehler} Fehler`);
if (fehler) process.exit(1);
