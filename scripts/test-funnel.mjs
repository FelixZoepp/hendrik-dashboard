// Prüft die reine Logik der Funnel-Eintragungen (Payload, Einwilligung, Sendefenster, Buchung).
// Aufruf: node scripts/test-funnel.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import {
  aufgabenText,
  buchungsUrl,
  ergebnisFuer,
  funnelKey,
  hatEinwilligung,
  imSendefenster,
  istFestnetz,
  istZustimmung,
  leseFunnelLead,
  leseFunnels,
  naechstesSendefenster,
  notizText,
  passtBuchung,
} from "../src/lib/funnel/logik.ts";

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
const berlin = (iso) => new Date(iso); // ISO mit Offset

console.log("Payload");
const perspective = {
  id: "abc123",
  funnelName: "Report Neukunden",
  profile: {
    firstName: { value: "Markus", title: "Vorname" },
    lastName: { value: "Müller", title: "Nachname" },
    email: { value: "Markus@Mueller-Bau.de", title: "E-Mail" },
    phone: { value: "0151 2345 6789", title: "Telefonnummer" },
    company: { value: "Müller Bau GmbH", title: "Firma" },
    q1: { value: "5–10", title: "Wie viele Mitarbeiter haben Sie?" },
    whatsapp: { value: true, title: "Report per WhatsApp erhalten" },
    utm_source: { value: "facebook", title: "UTM Source" },
    utm_medium: { value: "UTM Medium", title: "UTM Medium" },
  },
};
test("Perspective-Profil lesen", () => {
  const l = leseFunnelLead(perspective);
  assert.equal(l.externalId, "abc123");
  assert.equal(l.funnelName, "Report Neukunden");
  assert.equal(l.name, "Markus Müller");
  assert.equal(l.vorname, "Markus");
  assert.equal(l.email, "markus@mueller-bau.de");
  assert.equal(l.telefon, "0151 2345 6789");
  assert.equal(l.firma, "Müller Bau GmbH");
  assert.equal(l.whatsappHaekchen, true);
  assert.deepEqual(l.utm, { source: "facebook" });
  assert.deepEqual(l.antworten.map((a) => a.frage), ["Wie viele Mitarbeiter haben Sie?", "Report per WhatsApp erhalten"]);
});
test("Flacher Body", () => {
  const l = leseFunnelLead({ name: "Anna Schmidt", email: "a@b.de", telefon: "+49 170 1234567", Branche: "Dachdecker" });
  assert.equal(l.name, "Anna Schmidt");
  assert.equal(l.vorname, "Anna");
  assert.equal(l.telefon, "+49 170 1234567");
  assert.equal(l.whatsappHaekchen, null);
  assert.deepEqual(l.antworten, [{ frage: "Branche", antwort: "Dachdecker" }]);
});
test("Häkchen „nein“", () => {
  const l = leseFunnelLead({ profile: { email: { value: "x@y.de" }, wa: { value: "Nein", title: "Kontakt per WhatsApp?" } } });
  assert.equal(l.whatsappHaekchen, false);
});
test("Zustimmung erkennen", () => {
  assert.equal(istZustimmung("Ja"), true);
  assert.equal(istZustimmung("true"), true);
  assert.equal(istZustimmung("Ich stimme zu"), true);
  assert.equal(istZustimmung("nein"), false);
  assert.equal(istZustimmung("Bitte nicht per WhatsApp"), false);
  assert.equal(istZustimmung(""), null);
});
test("Einwilligung", () => {
  assert.equal(hatEinwilligung({ whatsappHaekchen: true }, { einwilligung_ohne_haekchen: false }), true);
  assert.equal(hatEinwilligung({ whatsappHaekchen: false }, { einwilligung_ohne_haekchen: true }), false);
  assert.equal(hatEinwilligung({ whatsappHaekchen: null }, { einwilligung_ohne_haekchen: false }), false);
  assert.equal(hatEinwilligung({ whatsappHaekchen: null }, { einwilligung_ohne_haekchen: true }), true);
});
test("Festnetz", () => {
  assert.equal(istFestnetz("+4915123456789"), false);
  assert.equal(istFestnetz("+491701234567"), false);
  assert.equal(istFestnetz("+493083791884"), true);
  assert.equal(istFestnetz("+436641234567"), false);
});
test("Funnel-Kurzname", () => {
  assert.equal(funnelKey("Hoffmann – Report Neukunden!"), "hoffmann-report-neukunden");
  assert.equal(funnelKey("Größe & Übersicht"), "groesse-uebersicht");
  assert.equal(funnelKey(""), "funnel");
});
test("Einstellungen lesen (fehlerhafte Werte → Standard)", () => {
  const f = leseFunnels({ report: { name: "Report", report_url: "http://unsicher.de/a.pdf", erinnerung: false, zustaendig: "x" }, "BÖSE KEY": {} });
  assert.deepEqual(Object.keys(f), ["report"]);
  assert.equal(f.report.report_url, null);
  assert.equal(f.report.erinnerung, false);
  assert.equal(f.report.zustaendig, null);
  assert.equal(f.report.einwilligung_ohne_haekchen, false);
});
test("Notiz enthält alle Angaben", () => {
  const n = notizText(leseFunnelLead(perspective), "Report Neukunden", false);
  assert.match(n, /^Eintragung über Funnel „Report Neukunden“/);
  assert.match(n, /Wie viele Mitarbeiter haben Sie\?: 5–10/);
  assert.match(n, /utm_source: facebook/);
});

console.log("Sendefenster Mo–Fr 8–20 Uhr");
test("Mittwoch 14 Uhr → sofort", () => {
  const d = berlin("2026-10-21T14:00:00+02:00");
  assert.equal(imSendefenster(d), true);
  assert.equal(naechstesSendefenster(d).getTime(), d.getTime());
});
test("Mittwoch 20:05 → Donnerstag 8:00", () => {
  assert.equal(naechstesSendefenster(berlin("2026-10-21T20:05:00+02:00")).toISOString(), berlin("2026-10-22T08:00:00+02:00").toISOString());
});
test("Mittwoch 6:30 → Mittwoch 8:00", () => {
  assert.equal(naechstesSendefenster(berlin("2026-10-21T06:30:00+02:00")).toISOString(), berlin("2026-10-21T08:00:00+02:00").toISOString());
});
test("Freitag 21 Uhr → Montag 8:00", () => {
  assert.equal(naechstesSendefenster(berlin("2026-10-23T21:00:00+02:00")).toISOString(), berlin("2026-10-26T08:00:00+01:00").toISOString());
});
test("Samstag 11 Uhr → Montag 8:00 (Winterzeit)", () => {
  assert.equal(imSendefenster(berlin("2026-10-24T11:00:00+02:00")), false);
  assert.equal(naechstesSendefenster(berlin("2026-10-24T11:00:00+02:00")).toISOString(), berlin("2026-10-26T08:00:00+01:00").toISOString());
});
test("19:59 noch im Fenster, 20:00 nicht", () => {
  assert.equal(imSendefenster(berlin("2026-10-21T19:59:00+02:00")), true);
  assert.equal(imSendefenster(berlin("2026-10-21T20:00:00+02:00")), false);
});

console.log("Buchung");
const e = { email: "markus@mueller-bau.de", telefon: "+4915123456789", eingetragen_am: "2026-10-21T12:00:00Z" };
test("Gleiche E-Mail (Groß/klein) nach der Eintragung", () => {
  assert.equal(passtBuchung(e, { email: "Markus@Mueller-Bau.de", telefon: null, created_at: "2026-10-21T12:04:00Z" }), true);
});
test("Gleiche Nummer", () => {
  assert.equal(passtBuchung(e, { email: "andere@x.de", telefon: "+4915123456789", created_at: "2026-10-21T12:30:00Z" }), true);
});
test("Alte Buchung zählt nicht", () => {
  assert.equal(passtBuchung(e, { email: "markus@mueller-bau.de", telefon: null, created_at: "2026-10-20T12:00:00Z" }), false);
});
test("Fremde Buchung zählt nicht", () => {
  assert.equal(passtBuchung(e, { email: "x@y.de", telefon: "+4917000000", created_at: "2026-10-21T12:04:00Z" }), false);
});
test("Ergebnis", () => {
  const t = new Date("2026-10-21T12:00:00Z");
  assert.equal(ergebnisFuer(t, new Date("2026-10-21T12:08:00Z")), "direkt_gebucht");
  assert.equal(ergebnisFuer(t, new Date("2026-10-21T12:30:00Z")), "spaeter_gebucht");
  assert.equal(ergebnisFuer(t, null), "nicht_gebucht");
});
test("Buchungslink vorbelegt", () => {
  const u = new URL(buchungsUrl("https://calendly.com/hoffmann/erstgespraech", { name: "Markus Müller", email: "m@x.de", funnel: "report" }));
  assert.equal(u.searchParams.get("name"), "Markus Müller");
  assert.equal(u.searchParams.get("email"), "m@x.de");
  assert.equal(u.searchParams.get("utm_source"), "whatsapp");
  assert.equal(u.searchParams.get("utm_campaign"), "report");
});
test("Aufgabentext", () => {
  assert.equal(
    aufgabenText({ name: "Markus Müller", firma: "Müller Bau GmbH", telefon: "+4915123456789" }, "Report"),
    "Jetzt anrufen: Markus Müller (Müller Bau GmbH) hat sich über „Report“ eingetragen, aber keinen Termin gebucht – +4915123456789",
  );
});

console.log(`\n${ok} ok, ${fehler} Fehler`);
if (fehler) process.exit(1);
