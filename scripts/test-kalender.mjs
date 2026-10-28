// Prüft die reine Kalender-Logik: Token aus URL, Abo-Links (Google/Apple/Outlook), Buchungslink, ICS-Feed (Europe/Berlin).
// Aufruf: node scripts/test-kalender.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import {
  aboLinks,
  berlinStempel,
  falte,
  icsFeed,
  icsText,
  istKalenderToken,
  pruefeBuchungslink,
  terminLinkText,
  tokenAusSegment,
} from "../src/lib/kalender/logik.ts";

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

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcd"; // 42 Zeichen

console.log("Token");
test("gültig: base64url ≥ 32 Zeichen", () => {
  assert.equal(istKalenderToken(TOKEN), true);
  assert.equal(istKalenderToken("kurz"), false);
  assert.equal(istKalenderToken("a".repeat(31)), false);
  assert.equal(istKalenderToken("a".repeat(32)), true);
  assert.equal(istKalenderToken(`${"a".repeat(40)}/../x`), false);
  assert.equal(istKalenderToken(null), false);
});
test("Segment mit/ohne .ics", () => {
  assert.equal(tokenAusSegment(`${TOKEN}.ics`), TOKEN);
  assert.equal(tokenAusSegment(`${TOKEN}.ICS`), TOKEN);
  assert.equal(tokenAusSegment(TOKEN), TOKEN);
  assert.equal(tokenAusSegment("abc.ics"), null);
  assert.equal(tokenAusSegment("%E0%A4%A"), null);
  assert.equal(tokenAusSegment(""), null);
});

console.log("Abo-Links");
test("https, webcal, Google cid, Outlook addfromweb", () => {
  const l = aboLinks("https://cloud.example.de/", TOKEN, "Muster – Anfragen");
  assert.equal(l.https, `https://cloud.example.de/api/kalender/${TOKEN}.ics`);
  assert.equal(l.webcal, `webcal://cloud.example.de/api/kalender/${TOKEN}.ics`);
  assert.equal(l.apple, l.webcal);
  assert.equal(l.google, `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(l.webcal)}`);
  assert.ok(l.outlook.startsWith("https://outlook.live.com/calendar/0/addfromweb?url=" + encodeURIComponent(l.https)));
  assert.ok(l.outlook.includes("&name=Muster%20%E2%80%93%20Anfragen"));
});
test("http (lokal) → webcal", () => {
  assert.equal(aboLinks("http://localhost:3000", TOKEN).webcal, `webcal://localhost:3000/api/kalender/${TOKEN}.ics`);
});

console.log("Buchungslink");
test("leer = entfernen", () => assert.deepEqual(pruefeBuchungslink("  "), { wert: null, fehler: null }));
test("https ok, normalisiert", () => assert.equal(pruefeBuchungslink(" https://calendly.com/max ").wert, "https://calendly.com/max"));
test("http, javascript:, ohne Schema → Fehler", () => {
  assert.ok(pruefeBuchungslink("http://calendly.com/max").fehler);
  assert.ok(pruefeBuchungslink("javascript:alert(1)").fehler);
  assert.ok(pruefeBuchungslink("calendly.com/max").fehler);
  assert.ok(pruefeBuchungslink("https://localhost/x").fehler);
  assert.ok(pruefeBuchungslink("https://a:b@calendly.com/x").fehler);
  assert.ok(pruefeBuchungslink(`https://calendly.com/${"x".repeat(600)}`).fehler);
});
test("Kopiertext mit Name, Link und Firma", () => {
  const t = terminLinkText("Anna", "https://calendly.com/max", "Dach Müller");
  assert.ok(t.startsWith("Hallo Anna,"));
  assert.ok(t.includes("https://calendly.com/max"));
  assert.ok(t.endsWith("Dach Müller"));
  assert.ok(terminLinkText("", "https://x.de").startsWith("Hallo,"));
});

console.log("ICS");
test("Berliner Ortszeit (Sommer- und Winterzeit)", () => {
  assert.equal(berlinStempel(new Date("2026-07-01T08:30:00Z")), "20260701T103000");
  assert.equal(berlinStempel(new Date("2026-12-01T08:30:00Z")), "20261201T093000");
  assert.equal(berlinStempel(new Date("2026-10-25T00:30:00Z")), "20261025T023000");
});
test("Escapen + Falten", () => {
  assert.equal(icsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const lang = "DESCRIPTION:" + "ä".repeat(80);
  const gefaltet = falte(lang);
  for (const zeile of gefaltet.split("\r\n")) assert.ok(new TextEncoder().encode(zeile).length <= 75);
  assert.equal(gefaltet.split("\r\n ").join(""), lang);
});

const jetzt = new Date("2026-10-28T09:00:00Z");
const feed = icsFeed({
  firmenName: "Dach Müller",
  basisUrl: "https://cloud.example.de",
  jetzt,
  termine: [
    { id: "t1", leadId: "l1", art: "vor_ort", beginn: "2026-10-29T08:00:00Z", status: "geplant", name: "Anna Schmidt", telefon: "+49 171 1234567", anliegen: "Dach undicht, bitte schnell" },
    { id: "t2", leadId: "l2", art: "telefon", beginn: "2026-10-30T13:00:00Z", status: "abgesagt", name: "Weg", telefon: null, anliegen: null },
    { id: "t3", leadId: "l3", art: "video", beginn: "2026-10-27T13:00:00Z", status: "nicht_erschienen", name: "Bert", telefon: null, anliegen: null },
  ],
  rueckrufe: [{ leadId: "l4", am: "2026-10-28T12:15:00Z", name: "Carla", telefon: "0171 9", anliegen: null }],
});
const ungefaltet = feed.replace(/\r\n /g, "");

test("Grundgerüst: VCALENDAR, CRLF, Zeitzone, Name, Aktualisierung", () => {
  assert.ok(feed.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(feed.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(feed), "nur CRLF");
  assert.ok(feed.includes("X-WR-TIMEZONE:Europe/Berlin"));
  assert.ok(feed.includes("BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin"));
  assert.ok(ungefaltet.includes("X-WR-CALNAME:Dach Müller – Anfragen & Termine"));
  assert.ok(feed.includes("REFRESH-INTERVAL;VALUE=DURATION:PT1H"));
});
test("Termin vor Ort: 60 Min, Ortszeit, Name/Telefon/Anliegen, Link", () => {
  assert.ok(ungefaltet.includes("UID:termin-t1@hoffmann-solutions-cloud"));
  assert.ok(ungefaltet.includes("DTSTART;TZID=Europe/Berlin:20261029T090000"));
  assert.ok(ungefaltet.includes("DTEND;TZID=Europe/Berlin:20261029T100000"));
  assert.ok(ungefaltet.includes("SUMMARY:Termin vor Ort: Anna Schmidt"));
  assert.ok(ungefaltet.includes("Telefon: +49 171 1234567\\nAnliegen: Dach undicht\\, bitte schnell"));
  assert.ok(ungefaltet.includes("URL:https://cloud.example.de/leads/l1"));
});
test("abgesagt/verschoben fehlen, Nicht erschienen ist markiert", () => {
  assert.ok(!ungefaltet.includes("termin-t2@"));
  assert.ok(ungefaltet.includes("SUMMARY:Nicht erschienen – Videotermin: Bert"));
  assert.ok(ungefaltet.includes("DTEND;TZID=Europe/Berlin:20261027T143000"));
});
test("Rückruf: 15 Min, stabile UID je Lead", () => {
  assert.ok(ungefaltet.includes("UID:rueckruf-l4@hoffmann-solutions-cloud"));
  assert.ok(ungefaltet.includes("SUMMARY:Rückruf: Carla"));
  assert.ok(ungefaltet.includes("DTSTART;TZID=Europe/Berlin:20261028T131500"));
  assert.ok(ungefaltet.includes("DTEND;TZID=Europe/Berlin:20261028T133000"));
});
test("Anzahl Ereignisse + DTSTAMP", () => {
  assert.equal(feed.match(/BEGIN:VEVENT/g).length, 3);
  assert.ok(feed.includes("DTSTAMP:20261028T090000Z"));
});
test("leerer Feed ist gültig", () => {
  const leer = icsFeed({ firmenName: "", basisUrl: "https://x.de", termine: [], rueckrufe: [], jetzt });
  assert.ok(leer.includes("X-WR-CALNAME:Anfragen & Termine"));
  assert.ok(!leer.includes("BEGIN:VEVENT"));
});

console.log(`\n${ok} ok, ${fehler} Fehler`);
if (fehler) process.exit(1);
