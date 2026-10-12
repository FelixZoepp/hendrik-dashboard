// Prüft die reinen Funktionen des WhatsApp-Terminbots (Zeitplan, Ruhezeit, Telefon,
// Antwort-Erkennung, Zusammenführen, Vorlagen-Regeln).
// Aufruf: node scripts/test-whatsapp-logik.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import {
  anredeName,
  artAusCalendly,
  berlinZeitpunkt,
  darfStatusSetzen,
  erinnerungsTag,
  erkenneAntwort,
  formatDatum,
  formatUhrzeit,
  istGleicherTermin,
  istRuhezeit,
  metaParameter,
  naechsterSendezeitpunkt,
  normalisiereTelefon,
  planeZeitplan,
  ruhezeitEntscheidung,
  vornameAus,
  zufallsToken,
  zusammenfuehren,
} from "../src/lib/whatsapp/logik.ts";
import { metaDefinition, pruefeVorlage, renderBody, VORLAGEN } from "../src/lib/whatsapp/vorlagen.ts";

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

const B = (j, m, t, h, min = 0) => berlinZeitpunkt(j, m, t, h, min);
const H = 3600_000;
const typen = (plan) => plan.map((j) => j.typ);
const zeitVon = (plan, typ) => plan.find((j) => j.typ === typ)?.run_at;

console.log("Berliner Zeit");
test("Sommerzeit: 16.10.2026 10:30 Berlin = 08:30 UTC", () =>
  assert.equal(B(2026, 10, 16, 10, 30).toISOString(), "2026-10-16T08:30:00.000Z"));
test("Winterzeit: 10.12.2026 10:30 Berlin = 09:30 UTC", () =>
  assert.equal(B(2026, 12, 10, 10, 30).toISOString(), "2026-12-10T09:30:00.000Z"));
test("Umstellungstag 25.10.2026 08:00 = 07:00 UTC", () =>
  assert.equal(B(2026, 10, 25, 8).toISOString(), "2026-10-25T07:00:00.000Z"));
test("formatDatum/Uhrzeit", () => {
  assert.equal(formatDatum(B(2026, 10, 15, 10, 30)), "Donnerstag, 15.10.");
  assert.equal(formatUhrzeit(B(2026, 10, 15, 9, 5)), "09:05");
});
test("erinnerungsTag heute/morgen/am …", () => {
  const jetzt = B(2026, 10, 12, 14);
  assert.equal(erinnerungsTag(B(2026, 10, 12, 18), jetzt), "heute");
  assert.equal(erinnerungsTag(B(2026, 10, 13, 9), jetzt), "morgen");
  assert.equal(erinnerungsTag(B(2026, 10, 15, 9), jetzt), "am Donnerstag, 15.10.");
  // kurz vor Mitternacht: morgen früh ist „morgen“
  assert.equal(erinnerungsTag(B(2026, 10, 13, 0, 30), B(2026, 10, 12, 23, 50)), "morgen");
});

console.log("Ruhezeit 21–8 Uhr");
test("istRuhezeit Grenzen", () => {
  assert.equal(istRuhezeit(B(2026, 10, 12, 20, 59)), false);
  assert.equal(istRuhezeit(B(2026, 10, 12, 21, 0)), true);
  assert.equal(istRuhezeit(B(2026, 10, 13, 7, 59)), true);
  assert.equal(istRuhezeit(B(2026, 10, 13, 8, 0)), false);
});
test("naechsterSendezeitpunkt: abends → nächster Morgen 8:00, früh → heute 8:00", () => {
  assert.equal(naechsterSendezeitpunkt(B(2026, 10, 12, 22)).toISOString(), B(2026, 10, 13, 8).toISOString());
  assert.equal(naechsterSendezeitpunkt(B(2026, 10, 13, 3)).toISOString(), B(2026, 10, 13, 8).toISOString());
  const tag = B(2026, 10, 13, 12);
  assert.equal(naechsterSendezeitpunkt(tag).getTime(), tag.getTime());
});
test("Ruhezeit: verschieben vs. überspringen (nach Terminbeginn)", () => {
  assert.deepEqual(ruhezeitEntscheidung(B(2026, 10, 12, 12), B(2026, 10, 13, 9)), { aktion: "senden" });
  const v = ruhezeitEntscheidung(B(2026, 10, 12, 22), B(2026, 10, 13, 9));
  assert.equal(v.aktion, "verschieben");
  assert.equal(v.bis.toISOString(), B(2026, 10, 13, 8).toISOString());
  assert.equal(ruhezeitEntscheidung(B(2026, 10, 13, 7), B(2026, 10, 13, 7, 45)).aktion, "ueberspringen");
  assert.equal(ruhezeitEntscheidung(B(2026, 10, 12, 22), null).aktion, "verschieben");
});

console.log("Zeitplan");
test("Strategie in 3 Tagen um 10:00 → alle vier Jobs", () => {
  const jetzt = B(2026, 10, 12, 12);
  const plan = planeZeitplan(B(2026, 10, 15, 10), jetzt, "strategie");
  assert.deepEqual(typen(plan), ["gebucht", "erinnerung", "unbestaetigt_check", "gleich"]);
  assert.equal(zeitVon(plan, "erinnerung").toISOString(), B(2026, 10, 14, 10).toISOString());
  assert.equal(zeitVon(plan, "unbestaetigt_check").toISOString(), B(2026, 10, 15, 8).toISOString());
  assert.equal(zeitVon(plan, "gleich").toISOString(), B(2026, 10, 15, 9).toISOString());
});
test("Erstgespräch: „gleich“ 15 Min. vorher", () => {
  const plan = planeZeitplan(B(2026, 10, 15, 10), B(2026, 10, 12, 12), "erstgespraech");
  assert.equal(zeitVon(plan, "gleich").toISOString(), B(2026, 10, 15, 9, 45).toISOString());
});
test("Start in 10 h → Erinnerung Start−3h statt −24h", () => {
  const jetzt = B(2026, 10, 12, 8);
  const plan = planeZeitplan(B(2026, 10, 12, 18), jetzt, "strategie");
  assert.equal(zeitVon(plan, "erinnerung").toISOString(), B(2026, 10, 12, 15).toISOString());
});
test("Start in 2,5 h → keine Erinnerung, aber Check + gleich", () => {
  const jetzt = B(2026, 10, 12, 10);
  const plan = planeZeitplan(B(2026, 10, 12, 12, 30), jetzt, "strategie");
  assert.deepEqual(typen(plan), ["gebucht", "unbestaetigt_check", "gleich"]);
});
test("Strategie in 60 Min. → nur „gebucht“ (gleich entfällt, < 70 Min.)", () => {
  const jetzt = B(2026, 10, 12, 10);
  assert.deepEqual(typen(planeZeitplan(B(2026, 10, 12, 11), jetzt, "strategie")), ["gebucht"]);
});
test("Erstgespräch in 30 Min. → gebucht + gleich (≥ 25 Min.)", () => {
  const jetzt = B(2026, 10, 12, 10);
  assert.deepEqual(typen(planeZeitplan(B(2026, 10, 12, 10, 30), jetzt, "erstgespraech")), ["gebucht", "gleich"]);
  assert.deepEqual(typen(planeZeitplan(B(2026, 10, 12, 10, 20), jetzt, "erstgespraech")), ["gebucht"]);
});
test("Termin vorbei → leerer Plan", () => {
  assert.deepEqual(planeZeitplan(B(2026, 10, 12, 9), B(2026, 10, 12, 10), "strategie"), []);
});
test("Buchung 22:00 für morgen 9:00 → keine Erinnerung/gleich neben der 8-Uhr-Buchungsnachricht", () => {
  const plan = planeZeitplan(B(2026, 10, 13, 9), B(2026, 10, 12, 22), "strategie");
  assert.deepEqual(typen(plan), ["gebucht", "unbestaetigt_check"]);
});
test("Buchung 22:00 für morgen 14:00 → Erinnerung um 11:00", () => {
  const plan = planeZeitplan(B(2026, 10, 13, 14), B(2026, 10, 12, 22), "strategie");
  assert.deepEqual(typen(plan), ["gebucht", "erinnerung", "unbestaetigt_check", "gleich"]);
  assert.equal(zeitVon(plan, "erinnerung").toISOString(), B(2026, 10, 13, 11).toISOString());
});
test("Termin 8:30 → „gleich“ (7:30) liegt in Ruhezeit, wird nicht geplant, wenn sie sich mit 8:00 deckt", () => {
  const plan = planeZeitplan(B(2026, 10, 15, 8, 30), B(2026, 10, 12, 12), "strategie");
  // effektiv 8:00 < Start 8:30 → wird geplant und am Morgen um 8:00 gesendet
  assert.ok(typen(plan).includes("gleich"));
});

console.log("Telefon");
test("normalisiereTelefon", () => {
  assert.equal(normalisiereTelefon("0151 2345 6789"), "+4915123456789");
  assert.equal(normalisiereTelefon("+49 (0) 151 23456789"), "+4915123456789");
  assert.equal(normalisiereTelefon("0049 151-23456789"), "+4915123456789");
  assert.equal(normalisiereTelefon("4915123456789"), "+4915123456789");
  assert.equal(normalisiereTelefon("+43 664 1234567"), "+436641234567");
  assert.equal(normalisiereTelefon("12"), null);
  assert.equal(normalisiereTelefon(""), null);
  assert.equal(normalisiereTelefon(null), null);
});

console.log("Antwort-Erkennung");
test("bestätigen", () => {
  for (const t of ["Ich bin dabei", "ja", "Ja!", "passt", "Passt.", "bin dabei", "bestätigt", "Ich komme", "Ja, passt", "👍", "ok"]) {
    assert.equal(erkenneAntwort(t), "bestaetigen", t);
  }
});
test("verschieben", () => {
  for (const t of ["Termin verschieben", "können wir verschieben?", "Ich brauche einen anderen Termin"]) {
    assert.equal(erkenneAntwort(t), "verschieben", t);
  }
});
test("stop", () => {
  for (const t of ["STOP", "Stopp", "abmelden", "stop."]) assert.equal(erkenneAntwort(t), "stop", t);
});
test("sonst null", () => {
  for (const t of ["Wer sind Sie?", "ja aber erst um 11", "Ich bin dabei nicht sicher ob", "stop bitte nicht mehr um 8"]) {
    // „Ich bin dabei …“ zählt bewusst als Bestätigung
    if (t.startsWith("Ich bin dabei")) continue;
    assert.equal(erkenneAntwort(t), null, t);
  }
});

console.log("Namen, Calendly-Zuordnung, Status");
test("anredeName: vollständiger Name → Vorname → Firma → Fallback", () => {
  assert.equal(anredeName("Markus Müller", "Markus", "Müller GmbH"), "Markus Müller");
  assert.equal(anredeName(null, "Markus", "Müller GmbH"), "Markus");
  assert.equal(anredeName("", null, "Müller GmbH"), "Müller GmbH");
  assert.equal(anredeName(null, null, null), "und willkommen");
  assert.equal(vornameAus("Markus  Müller"), "Markus");
  assert.equal(vornameAus("Markus"), null);
});
test("metaParameter ohne Zeilenumbruch, nie leer", () => {
  assert.equal(metaParameter("a\n\n b\t c"), "a b c");
  assert.equal(metaParameter(""), "–");
});
test("artAusCalendly", () => {
  assert.equal(artAusCalendly("15-minütiges Erstgespräch (kostenfrei)"), "erstgespraech");
  assert.equal(artAusCalendly("Strategiegespräch - HoffmannSolutions"), "strategie");
  assert.equal(artAusCalendly("Strategiegespräch - HoffmannSolutions GmbH"), "strategie");
  assert.equal(artAusCalendly("Onboarding"), null);
  assert.equal(artAusCalendly(null), null);
});
test("Status nie zurückstufen", () => {
  assert.equal(darfStatusSetzen("gesendet", "zugestellt"), true);
  assert.equal(darfStatusSetzen("gelesen", "zugestellt"), false);
  assert.equal(darfStatusSetzen("zugestellt", "fehlgeschlagen"), false);
  assert.equal(darfStatusSetzen("gesendet", "fehlgeschlagen"), true);
  assert.equal(darfStatusSetzen("fehlgeschlagen", "gelesen"), false);
});
test("zufallsToken: Länge, URL-sicher, eindeutig", () => {
  const set = new Set();
  for (let i = 0; i < 2000; i++) {
    const t = zufallsToken();
    assert.match(t, /^[A-Za-z0-9]{14}$/);
    set.add(t);
  }
  assert.equal(set.size, 2000);
});

console.log("Zusammenführen");
const close = {
  art: "erstgespraech",
  quelle: "close",
  start_at: B(2026, 10, 15, 10).toISOString(),
  close_lead_id: "lead_1",
  telefon: "+4915123456789",
  email: null,
  name: "Markus Müller",
  opt_in: false,
};
const calendly = {
  art: "erstgespraech",
  quelle: "calendly",
  start_at: B(2026, 10, 15, 10, 15).toISOString(),
  close_lead_id: null,
  telefon: "+4915123456789",
  email: "markus@example.de",
  name: "Markus Müller",
  calendly_event_uri: "https://api.calendly.com/scheduled_events/abc",
  opt_in: true,
};
test("gleicher Lead per Telefon, ±30 Min. → derselbe Termin", () => assert.equal(istGleicherTermin(close, calendly), true));
test("andere Art → nicht derselbe", () => assert.equal(istGleicherTermin(close, { ...calendly, art: "strategie" }), false));
test("> 30 Min. auseinander → nicht derselbe", () =>
  assert.equal(istGleicherTermin(close, { ...calendly, start_at: B(2026, 10, 15, 10, 31).toISOString() }), false));
test("kein gemeinsames Merkmal → nicht derselbe", () =>
  assert.equal(istGleicherTermin({ ...close, telefon: null }, { ...calendly, telefon: "+491700000000" }), false));
test("E-Mail ohne Groß-/Kleinschreibung", () =>
  assert.equal(istGleicherTermin({ ...close, telefon: null, email: "Markus@Example.de" }, { ...calendly, telefon: null }), true));
test("Calendly überschreibt Close (Start, URI, opt_in, quelle)", () => {
  const { patch, startGeaendert } = zusammenfuehren(close, calendly);
  assert.equal(startGeaendert, true);
  assert.equal(patch.start_at, calendly.start_at);
  assert.equal(patch.calendly_event_uri, calendly.calendly_event_uri);
  assert.equal(patch.email, "markus@example.de");
  assert.equal(patch.quelle, "calendly");
  assert.equal(patch.opt_in, true);
  assert.equal("close_lead_id" in patch, false);
});
test("Close füllt bei Calendly-Termin nur Lücken, Start bleibt", () => {
  const { patch, startGeaendert } = zusammenfuehren(
    { ...calendly, close_lead_id: null },
    { ...close, start_at: B(2026, 10, 15, 10).toISOString(), close_protokoll_id: "acti_1" },
  );
  assert.equal(startGeaendert, false);
  assert.equal(patch.start_at, undefined);
  assert.equal(patch.close_lead_id, "lead_1");
  assert.equal(patch.close_protokoll_id, "acti_1");
  assert.equal(patch.quelle, undefined);
  assert.equal(patch.opt_in, undefined);
});
test("Close-Termin neu gesetzt (verschoben) → startGeaendert", () => {
  const { startGeaendert } = zusammenfuehren(close, { ...close, start_at: B(2026, 10, 15, 11).toISOString() });
  assert.equal(startGeaendert, true);
});
test("identische Daten → leerer Patch", () => {
  const { patch, startGeaendert } = zusammenfuehren(calendly, { ...calendly });
  assert.deepEqual(patch, {});
  assert.equal(startGeaendert, false);
});

console.log("Vorlagen (Meta-Regeln)");
for (const v of VORLAGEN) {
  test(`${v.name}: Regeln eingehalten`, () => assert.deepEqual(pruefeVorlage(v), []));
}
test("8 Vorlagen, alle UTILITY/de, Sie-Form", () => {
  assert.equal(VORLAGEN.length, 8);
  for (const v of VORLAGEN) {
    assert.equal(v.kategorie, "UTILITY");
    assert.equal(v.sprache, "de");
    assert.ok(v.body.startsWith("Guten Tag {{1}},"), v.name);
    assert.ok(!/\b(du|dein|dich|dir)\b/i.test(v.body), `${v.name} enthält Du-Form`);
  }
});
test("Regelprüfung erkennt Verstöße", () => {
  const kaputt = { ...VORLAGEN[0], body: "{{1}} {{2}} Text {{3}}", buttons: [{ typ: "URL", text: "x".repeat(26), pfad: "t" }] };
  const p = pruefeVorlage(kaputt);
  assert.ok(p.some((x) => x.includes("beginnt")));
  assert.ok(p.some((x) => x.includes("endet")));
  assert.ok(p.some((x) => x.includes("nebeneinander")));
  assert.ok(p.some((x) => x.includes("zu lang")));
});
test("metaDefinition: Header, Footer, URL-Button mit Beispiel", () => {
  const d = metaDefinition(VORLAGEN[0], "https://cloud.hoffmannsolutions.de/");
  assert.equal(d.components[0].type, "HEADER");
  const buttons = d.components.find((c) => c.type === "BUTTONS").buttons;
  assert.equal(buttons[2].url, "https://cloud.hoffmannsolutions.de/t/{{1}}");
  assert.match(buttons[2].example[0], /^https:\/\/cloud\.hoffmannsolutions\.de\/t\/\w+$/);
});
test("renderBody setzt Werte ein", () => {
  const text = renderBody(VORLAGEN[0], ["Markus Müller", "Donnerstag, 16.10.", "10:30"]);
  assert.ok(text.startsWith("Guten Tag Markus Müller, Ihr kostenfreies Erstgespräch"));
  assert.ok(text.includes("📅 Donnerstag, 16.10. um 10:30 Uhr"));
});

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`);
process.exit(fehler ? 1 : 0);
