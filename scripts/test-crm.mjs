// Prüft die reine CRM-Logik (Stufen, Ampel, Kennzahlen, wa.me-Link, Rückruf-Schnellwahl in Berliner Zeit).
// Aufruf: node scripts/test-crm.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import {
  STUFEN,
  alterText,
  berechneKennzahlen,
  berlinZeit,
  dauerText,
  heuteAnrufen,
  heuteEnde,
  istStufe,
  leseEuro,
  leseZeitraum,
  pruefeStufenWechsel,
  rueckrufAusDatum,
  rueckrufText,
  rueckrufZeit,
  speedAmpel,
  statusFuerStufe,
  stufeVon,
  telLink,
  telefonE164Ziffern,
  teileName,
  waLink,
  zeitraumGrenzen,
} from "../src/lib/crm/logik.ts";

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
const t = (iso) => new Date(iso);
const vorMin = (jetzt, min) => new Date(jetzt.getTime() - min * 60_000).toISOString();

console.log("Stufen-Mapping");
test("genau 6 Stufen in richtiger Reihenfolge", () => {
  assert.deepEqual(
    STUFEN.map((s) => s.label),
    ["Neu", "Kontaktiert", "Termin vor Ort", "Angebot raus", "Auftrag ✅", "Verloren ❌"],
  );
});
test("jeder Enum-Status hat eine Stufe", () => {
  const erwartet = {
    neu: "neu",
    kontaktiert: "kontaktiert",
    termin_vereinbart: "termin",
    vor_ort_termin: "termin",
    angebot_raus: "angebot",
    gewonnen: "auftrag",
    verloren: "verloren",
    kein_interesse: "verloren",
    nicht_erreicht: "verloren",
  };
  for (const [status, stufe] of Object.entries(erwartet)) assert.equal(stufeVon(status), stufe, status);
});
test("Stufe → Zielstatus", () => {
  assert.equal(statusFuerStufe("termin"), "vor_ort_termin");
  assert.equal(statusFuerStufe("auftrag"), "gewonnen");
  assert.equal(statusFuerStufe("verloren"), "verloren");
  assert.equal(istStufe("angebot"), true);
  assert.equal(istStufe("gewonnen"), false);
});
test("Pflichtangaben beim Wechsel", () => {
  assert.equal(pruefeStufenWechsel({ stufe: "kontaktiert" }), null);
  assert.equal(pruefeStufenWechsel({ stufe: "angebot" }), null, "Angebotswert optional");
  assert.ok(pruefeStufenWechsel({ stufe: "auftrag" }));
  assert.ok(pruefeStufenWechsel({ stufe: "auftrag", auftragswert: 0 }));
  assert.equal(pruefeStufenWechsel({ stufe: "auftrag", auftragswert: 4500 }), null);
  assert.ok(pruefeStufenWechsel({ stufe: "verloren" }));
  assert.equal(pruefeStufenWechsel({ stufe: "verloren", verlust_grund: "zu_teuer" }), null);
  assert.ok(pruefeStufenWechsel({ stufe: "verloren", verlust_grund: "sonstiges", verlust_notiz: "  " }));
  assert.equal(pruefeStufenWechsel({ stufe: "verloren", verlust_grund: "sonstiges", verlust_notiz: "Umzug" }), null);
});
test("Euro-Eingabe lesen", () => {
  assert.equal(leseEuro("4.500"), 4500);
  assert.equal(leseEuro("4500,50"), 4500.5);
  assert.equal(leseEuro("1.234,5 €"), 1234.5);
  assert.equal(leseEuro("3 200"), 3200);
  assert.equal(leseEuro(""), null);
  assert.equal(leseEuro("abc"), null);
});

console.log("Speed-to-Lead-Ampel");
const jetzt = t("2026-10-28T10:00:00Z");
test("grün < 15 Min., gelb < 60, rot darüber", () => {
  const neu = (min) => ({ status: "neu", created_at: vorMin(jetzt, min), first_contact_at: null });
  assert.equal(speedAmpel(neu(0), jetzt), "gruen");
  assert.equal(speedAmpel(neu(14.9), jetzt), "gruen");
  assert.equal(speedAmpel(neu(15), jetzt), "gelb");
  assert.equal(speedAmpel(neu(59), jetzt), "gelb");
  assert.equal(speedAmpel(neu(60), jetzt), "rot");
});
test("keine Ampel nach Kontakt oder außerhalb von Neu", () => {
  assert.equal(speedAmpel({ status: "neu", created_at: vorMin(jetzt, 90), first_contact_at: vorMin(jetzt, 80) }, jetzt), null);
  assert.equal(speedAmpel({ status: "kontaktiert", created_at: vorMin(jetzt, 90), first_contact_at: null }, jetzt), null);
});
test("Alter als Text", () => {
  assert.equal(alterText(vorMin(jetzt, 0.2), jetzt), "gerade eben");
  assert.equal(alterText(vorMin(jetzt, 12), jetzt), "vor 12 Min.");
  assert.equal(alterText(vorMin(jetzt, 180), jetzt), "vor 3 Std.");
  assert.equal(alterText(vorMin(jetzt, 60 * 30), jetzt), "gestern");
  assert.equal(alterText(vorMin(jetzt, 60 * 24 * 4), jetzt), "vor 4 Tagen");
  assert.equal(dauerText(8), "8 Min.");
  assert.equal(dauerText(125), "2 Std. 5 Min.");
  assert.equal(dauerText(60 * 24 * 3), "3 Tage");
});

console.log("Telefon / WhatsApp");
test("Nummern → E.164", () => {
  assert.equal(telefonE164Ziffern("0151 2345 6789"), "4915123456789");
  assert.equal(telefonE164Ziffern("+49 (0) 151-2345678"), "491512345678");
  assert.equal(telefonE164Ziffern("0049 30 1234567"), "49301234567");
  assert.equal(telefonE164Ziffern("+43 660 1234567"), "436601234567");
  assert.equal(telefonE164Ziffern("4915123456789"), "4915123456789");
  assert.equal(telefonE164Ziffern("12"), null);
  assert.equal(telefonE164Ziffern(""), null);
  assert.equal(telLink("0151 2345 6789"), "tel:+4915123456789");
});
test("wa.me-Link mit Gruß und Firmenname", () => {
  const link = waLink("0151 2345 6789", "Tischlerei Krüger", "Anna");
  const u = new URL(link);
  assert.equal(u.origin + u.pathname, "https://wa.me/4915123456789");
  const text = u.searchParams.get("text");
  assert.ok(text.includes("Tischlerei Krüger"), text);
  assert.ok(text.startsWith("Guten Tag Anna"), text);
  assert.ok(!link.includes("+"), "kein + in der Nummer und Leerzeichen als %20");
  assert.equal(waLink(null, "X"), null);
});

console.log("Rückruf-Schnellwahl (Europe/Berlin)");
test("Berliner Wandzeit → UTC (Sommer/Winter)", () => {
  assert.equal(berlinZeit(2026, 7, 1, 9, 0).toISOString(), "2026-07-01T07:00:00.000Z");
  assert.equal(berlinZeit(2026, 12, 1, 9, 0).toISOString(), "2026-12-01T08:00:00.000Z");
  // Zeitumstellung 25.10.2026 (03:00 → 02:00)
  assert.equal(berlinZeit(2026, 10, 25, 9, 0).toISOString(), "2026-10-25T08:00:00.000Z");
  assert.equal(berlinZeit(2026, 10, 24, 9, 0).toISOString(), "2026-10-24T07:00:00.000Z");
});
test("morgen 9 Uhr / in 2 Tagen", () => {
  const mi = t("2026-10-28T10:20:00Z"); // 11:20 Berlin (Winterzeit)
  assert.equal(rueckrufZeit("morgen_9", mi).toISOString(), "2026-10-29T08:00:00.000Z");
  assert.equal(rueckrufZeit("in_2_tagen", mi).toISOString(), "2026-10-30T08:00:00.000Z");
  // kurz vor Mitternacht Berlin, aber in UTC noch „gestern“
  const spaet = t("2026-10-28T22:30:00Z"); // 23:30 Berlin
  assert.equal(rueckrufZeit("morgen_9", spaet).toISOString(), "2026-10-29T08:00:00.000Z");
  // über die Zeitumstellung hinweg
  const sa = t("2026-10-24T10:00:00Z"); // Sa 12:00 MESZ
  assert.equal(rueckrufZeit("morgen_9", sa).toISOString(), "2026-10-25T08:00:00.000Z");
  // Monatsende
  assert.equal(rueckrufZeit("in_2_tagen", t("2026-10-30T10:00:00Z")).toISOString(), "2026-11-01T08:00:00.000Z");
});
test("heute später: nächste volle Stunde + 2, nach 20 Uhr ausgeblendet", () => {
  assert.equal(rueckrufZeit("heute_spaeter", t("2026-10-28T10:20:00Z")).toISOString(), "2026-10-28T13:00:00.000Z"); // 14:00 Berlin
  assert.equal(rueckrufZeit("heute_spaeter", t("2026-10-28T16:59:00Z")).toISOString(), "2026-10-28T19:00:00.000Z"); // 20:00
  assert.equal(rueckrufZeit("heute_spaeter", t("2026-10-28T17:05:00Z")), null); // 18:05 → 21:00
});
test("Datum + Uhrzeit aus dem Formular", () => {
  assert.equal(rueckrufAusDatum("2026-11-03").toISOString(), "2026-11-03T08:00:00.000Z");
  assert.equal(rueckrufAusDatum("2026-08-03", "14:30").toISOString(), "2026-08-03T12:30:00.000Z");
  assert.equal(rueckrufAusDatum("03.11.2026"), null);
  assert.equal(rueckrufAusDatum("2026-11-03", "25:00"), null);
});
test("Rückruf-Text und Tagesende", () => {
  const mi = t("2026-10-28T10:20:00Z");
  assert.equal(heuteEnde(mi).toISOString(), "2026-10-28T23:00:00.000Z");
  assert.equal(rueckrufText("2026-10-28T13:00:00Z", mi), "heute 14:00");
  assert.equal(rueckrufText("2026-10-29T08:00:00Z", mi), "morgen 09:00");
  assert.equal(rueckrufText("2026-10-27T08:00:00Z", mi), "gestern 09:00");
});

console.log("Heute anrufen");
test("neue ohne Kontakt + fällige Rückrufe, ohne Abschlüsse", () => {
  const mi = t("2026-10-28T10:20:00Z");
  const leads = [
    { id: "a", status: "neu", created_at: "2026-10-28T09:00:00Z", first_contact_at: null, naechste_aktion_am: null },
    { id: "b", status: "neu", created_at: "2026-10-27T09:00:00Z", first_contact_at: null, naechste_aktion_am: null },
    { id: "c", status: "kontaktiert", created_at: "2026-10-20T09:00:00Z", first_contact_at: "2026-10-20T09:05:00Z", naechste_aktion_am: "2026-10-28T20:00:00Z" },
    { id: "d", status: "angebot_raus", created_at: "2026-10-10T09:00:00Z", first_contact_at: "2026-10-10T09:05:00Z", naechste_aktion_am: "2026-10-27T08:00:00Z" },
    { id: "e", status: "kontaktiert", created_at: "2026-10-20T09:00:00Z", first_contact_at: "2026-10-20T09:05:00Z", naechste_aktion_am: "2026-10-29T08:00:00Z" },
    { id: "f", status: "gewonnen", created_at: "2026-10-20T09:00:00Z", first_contact_at: null, naechste_aktion_am: "2026-10-27T08:00:00Z" },
    { id: "g", status: "neu", created_at: "2026-10-28T08:00:00Z", first_contact_at: "2026-10-28T08:01:00Z", naechste_aktion_am: null },
  ];
  const r = heuteAnrufen(leads, mi);
  assert.deepEqual(r.map((x) => x.id), ["b", "a", "d", "c"]);
  assert.deepEqual(r.map((x) => x.grund), ["neu", "neu", "ueberfaellig", "rueckruf"]);
});

console.log("Kennzahlen");
test("Quoten, Summen, Reaktionszeit", () => {
  const k = berechneKennzahlen([
    { status: "neu", created_at: "2026-10-01T10:00:00Z", first_contact_at: null, angebotswert: null, auftragswert: null },
    { status: "kontaktiert", created_at: "2026-10-01T10:00:00Z", first_contact_at: "2026-10-01T10:10:00Z", angebotswert: null, auftragswert: null },
    { status: "vor_ort_termin", created_at: "2026-10-01T10:00:00Z", first_contact_at: "2026-10-01T10:20:00Z", angebotswert: null, auftragswert: null },
    { status: "angebot_raus", created_at: "2026-10-01T10:00:00Z", first_contact_at: "2026-10-01T10:30:00Z", angebotswert: 3000, auftragswert: null },
    { status: "gewonnen", created_at: "2026-10-01T10:00:00Z", first_contact_at: "2026-10-01T10:40:00Z", angebotswert: 5000, auftragswert: 4800 },
    // verloren nach Termin + Angebot (Verlauf zählt mit)
    { status: "verloren", created_at: "2026-10-01T10:00:00Z", first_contact_at: null, angebotswert: 2000, auftragswert: null, verlauf: ["kontaktiert", "vor_ort_termin", "angebot_raus", "verloren"] },
    // altes nicht_erreicht → verloren, nie Termin
    { status: "nicht_erreicht", created_at: "2026-10-01T10:00:00Z", first_contact_at: null, angebotswert: null, auftragswert: null },
    // termin_vereinbart zählt als Termin
    { status: "termin_vereinbart", created_at: "2026-10-01T10:00:00Z", first_contact_at: "2026-10-01T10:50:00Z", angebotswert: null, auftragswert: null },
  ]);
  assert.equal(k.anfragen, 8);
  assert.equal(k.kontaktiert, 7, "alle außer Neu ohne Kontakt");
  assert.equal(k.kontaktiertQuote, 88);
  assert.equal(k.termine, 5, "Termin, Angebot, Auftrag, verloren-nach-Termin, termin_vereinbart");
  assert.equal(k.angebote, 3);
  assert.equal(k.angeboteSumme, 10000);
  assert.equal(k.auftraege, 1);
  assert.equal(k.umsatz, 4800);
  assert.equal(k.abschlussquote, 13);
  assert.equal(k.reaktionMinuten, 30); // (10+20+30+40+50)/5
});
test("leere Menge", () => {
  const k = berechneKennzahlen([]);
  assert.equal(k.anfragen, 0);
  assert.equal(k.kontaktiertQuote, null);
  assert.equal(k.abschlussquote, null);
  assert.equal(k.reaktionMinuten, null);
});
test("Zeiträume (Berlin)", () => {
  const mi = t("2026-10-28T10:20:00Z");
  assert.equal(leseZeitraum("90"), "90");
  assert.equal(leseZeitraum("x"), "30");
  assert.equal(zeitraumGrenzen("7", mi).von.toISOString(), "2026-10-21T22:00:00.000Z"); // 22.10. 00:00 MESZ
  assert.equal(zeitraumGrenzen("monat", mi).von.toISOString(), "2026-09-30T22:00:00.000Z");
  assert.equal(zeitraumGrenzen("30", mi).bis.toISOString(), mi.toISOString());
});

console.log("Namen");
test("ein Feld → Vor- und Nachname", () => {
  assert.deepEqual(teileName("  Max   von Mustermann "), { vorname: "Max", nachname: "von Mustermann" });
  assert.deepEqual(teileName("Cher"), { vorname: "Cher", nachname: "" });
});

console.log(`\n${ok} ok, ${fehler} Fehler`);
if (fehler) process.exit(1);
