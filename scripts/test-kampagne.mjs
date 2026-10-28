// Prüft die reine Logik „Kampagne & Berichte“ (Kennzahlen, Zuordnung, Monatsgrenzen Berlin, Meta-Parsing).
// Aufruf: node scripts/test-kampagne.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import {
  berechneKennzahlen,
  berlinDatum,
  euro,
  fasseZusammen,
  istWerbeLead,
  freierZeitraum,
  leadsAusAktionen,
  leseMetaInsight,
  leseZeitraum,
  manuellerAnteil,
  manuelleTageswerte,
  monatPlus,
  monatsZeitraum,
  normalisiereKampagnenId,
  normalisiereWerbekonto,
  offeneKampagnen,
  ordneZu,
  pruefeZuordnung,
  roiText,
  summeAusgaben,
  tageZeitraum,
  wochenMontag,
  wochenVerlauf,
  zaehleLeads,
  zusammenfassung,
} from "../src/lib/kampagne/logik.ts";

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

console.log("Kennzahlen");
test("CPL, ROI, Kosten je Auftrag", () => {
  const k = berechneKennzahlen(640, { leads: 23, termine: 8, auftraege: 2, umsatz: 4736 });
  assert.equal(Math.round(k.kostenJeLead * 100) / 100, 27.83);
  assert.equal(k.roi, 7.4);
  assert.equal(k.kostenJeAuftrag, 320);
  assert.equal(Math.round(k.terminQuote * 100), 35);
});
test("Division durch 0 → null (keine Leads, kein Budget, keine Aufträge)", () => {
  const ohneLeads = berechneKennzahlen(500, { leads: 0, termine: 0, auftraege: 0, umsatz: 0 });
  assert.equal(ohneLeads.kostenJeLead, null);
  assert.equal(ohneLeads.kostenJeAuftrag, null);
  assert.equal(ohneLeads.roi, 0);
  assert.equal(ohneLeads.terminQuote, null);
  const ohneBudget = berechneKennzahlen(0, { leads: 5, termine: 1, auftraege: 1, umsatz: 3000 });
  assert.equal(ohneBudget.roi, null);
  assert.equal(ohneBudget.kostenJeLead, null);
  assert.equal(ohneBudget.kostenJeAuftrag, null);
  const negativ = berechneKennzahlen(-10, { leads: 1, termine: 0, auftraege: 0, umsatz: 0 });
  assert.equal(negativ.ausgaben, 0);
  assert.equal(negativ.kostenJeLead, null);
});
test("Leads zählen: Werbe-Leads, Termine, Aufträge, Umsatz", () => {
  const l = (status, quelle, auftragswert = null, angebotswert = null) => ({
    status, quelle, auftragswert, angebotswert, created_at: "2026-10-05T10:00:00Z",
  });
  const z = zaehleLeads([
    l("neu", "meta"),
    l("vor_ort_termin", "meta"),
    l("angebot_raus", "google_ads", null, 8000),
    l("gewonnen", "perspective", "4500.50"),
    l("gewonnen", "meta", null),
    l("verloren", "meta", null, 3000), // Termin + Angebot, aber verloren
    l("verloren", "meta"),
    l("gewonnen", "manuell", 99999), // keine Werbung → zählt nicht
    l("neu", "empfehlung"),
  ]);
  assert.deepEqual(z, { leads: 7, termine: 5, auftraege: 2, umsatz: 4500.5 });
});
test("Testleads zählen nie", () => {
  const basis = { status: "gewonnen", quelle: "meta", auftragswert: 1000, created_at: "2026-10-05T10:00:00Z" };
  assert.equal(istWerbeLead({ quelle: "meta", ist_test: true }), false);
  assert.equal(istWerbeLead({ quelle: "meta", ist_test: false }), true);
  assert.equal(istWerbeLead({ quelle: "meta" }), true);
  assert.deepEqual(zaehleLeads([basis, { ...basis, ist_test: true }]), { leads: 1, termine: 1, auftraege: 1, umsatz: 1000 });
});

console.log("Texte");
test("Euro-Format", () => {
  assert.equal(euro(640), "640 €");
  assert.equal(euro(27.83), "28 €");
  assert.equal(euro(7.4), "7,40 €");
  assert.equal(euro(12345), "12.345 €");
});
test("ROI-Text", () => {
  assert.equal(roiText(7.4), "Für 1 € Werbung 7,40 € Umsatz");
  assert.equal(roiText(12.345), "Für 1 € Werbung 12,35 € Umsatz");
  assert.equal(roiText(null), null);
});
test("Zusammenfassung", () => {
  const k = berechneKennzahlen(640, { leads: 23, termine: 0, auftraege: 0, umsatz: 0 });
  assert.equal(zusammenfassung("Diesen Monat", k), "Diesen Monat: 23 Anfragen für 640 € – 28 € pro Anfrage");
  assert.equal(
    zusammenfassung("Letzte 7 Tage", berechneKennzahlen(50, { leads: 1, termine: 0, auftraege: 0, umsatz: 0 })),
    "Letzte 7 Tage: 1 Anfrage für 50 € – 50 € pro Anfrage",
  );
  assert.equal(
    zusammenfassung("Diesen Monat", berechneKennzahlen(0, { leads: 0, termine: 0, auftraege: 0, umsatz: 0 })),
    "Diesen Monat: noch keine Anfragen und keine Werbeausgaben",
  );
  assert.equal(
    zusammenfassung("Diesen Monat", berechneKennzahlen(120, { leads: 0, termine: 0, auftraege: 0, umsatz: 0 })),
    "Diesen Monat: 120 € Werbebudget, noch keine Anfragen",
  );
});

console.log("Zeiträume (Europe/Berlin)");
test("Monat im Winter: 1. 00:00 Berlin = 23:00 UTC Vortag", () => {
  const z = monatsZeitraum("2026-01", new Date("2026-10-28T12:00:00Z"));
  assert.equal(z.start.toISOString(), "2025-12-31T23:00:00.000Z");
  assert.equal(z.ende.toISOString(), "2026-01-31T23:00:00.000Z");
  assert.equal(z.vonDatum, "2026-01-01");
  assert.equal(z.bisDatum, "2026-01-31");
  assert.equal(z.label, "Januar 2026");
});
test("Monat mit Zeitumstellung (Oktober: Sommer → Winter, März: Winter → Sommer)", () => {
  const okt = monatsZeitraum("2026-10", new Date("2026-10-28T12:00:00Z"));
  assert.equal(okt.start.toISOString(), "2026-09-30T22:00:00.000Z");
  assert.equal(okt.ende.toISOString(), "2026-10-31T23:00:00.000Z");
  assert.equal(okt.label, "Diesen Monat");
  const mrz = monatsZeitraum("2026-03");
  assert.equal(mrz.start.toISOString(), "2026-02-28T23:00:00.000Z");
  assert.equal(mrz.ende.toISOString(), "2026-03-31T22:00:00.000Z");
});
test("Lead am 31.10. 23:30 Berlin gehört zum Oktober, 1.11. 00:30 zum November", () => {
  const okt = monatsZeitraum("2026-10");
  const spaet = new Date("2026-10-31T22:30:00Z"); // 23:30 Berlin (UTC+1)
  const frueh = new Date("2026-10-31T23:30:00Z"); // 00:30 Berlin am 1.11.
  assert.ok(spaet >= okt.start && spaet < okt.ende);
  assert.ok(!(frueh < okt.ende));
  assert.equal(berlinDatum(frueh), "2026-11-01");
});
test("Februar Schaltjahr + Monatswechsel über Jahresgrenze", () => {
  assert.equal(monatsZeitraum("2028-02").bisDatum, "2028-02-29");
  assert.equal(monatsZeitraum("2026-02").bisDatum, "2026-02-28");
  assert.equal(monatPlus("2026-01", -1), "2025-12");
  assert.equal(monatPlus("2026-12", 1), "2027-01");
  assert.equal(monatsZeitraum("2026-12").ende.toISOString(), "2026-12-31T23:00:00.000Z");
});
test("Letzte 7/30 Tage inkl. heute", () => {
  const now = new Date("2026-10-28T08:00:00Z");
  const z = tageZeitraum(7, now);
  assert.equal(z.vonDatum, "2026-10-22");
  assert.equal(z.bisDatum, "2026-10-28");
  assert.equal(z.start.toISOString(), "2026-10-21T22:00:00.000Z"); // 22.10. noch Sommerzeit
  assert.equal(z.ende, now);
  assert.equal(tageZeitraum(30, now).vonDatum, "2026-09-29");
});
test("URL-Parameter: monat, tage, Standard = aktueller Monat", () => {
  const now = new Date("2026-10-28T08:00:00Z");
  assert.equal(leseZeitraum({ monat: "2026-09" }, now).vonDatum, "2026-09-01");
  assert.equal(leseZeitraum({ tage: "90" }, now).tage, 90);
  assert.equal(leseZeitraum({ tage: "13" }, now).monat, "2026-10");
  assert.equal(leseZeitraum({ monat: "2026-13" }, now).monat, "2026-10");
  assert.equal(leseZeitraum({}, now).label, "Diesen Monat");
  // Kurz nach Mitternacht am 1. (Berlin), UTC noch Vormonat
  assert.equal(leseZeitraum({}, new Date("2026-10-31T23:10:00Z")).monat, "2026-11");
});
test("Freier Zeitraum (von/bis exkl.)", () => {
  const m = monatsZeitraum("2026-10");
  const f = freierZeitraum(m.start, m.ende);
  assert.equal(f.vonDatum, "2026-10-01");
  assert.equal(f.bisDatum, "2026-10-31");
  assert.equal(f.tage, 31);
});
test("Manuelle Kosten: ganzer Monat, anteilig, außerhalb", () => {
  const k = { monat: "2026-10-01", betrag: 310 };
  assert.equal(manuellerAnteil(k, "2026-10-01", "2026-10-31"), 310);
  assert.equal(manuellerAnteil(k, "2026-10-22", "2026-10-28"), 70);
  assert.equal(manuellerAnteil(k, "2026-09-01", "2026-09-30"), 0);
  assert.equal(manuellerAnteil({ monat: "2026-09-01", betrag: "300" }, "2026-09-29", "2026-10-28"), 20);
  assert.equal(summeAusgaben([{ ausgaben: "100.50" }, { ausgaben: 20 }], [k], "2026-10-22", "2026-10-28"), 190.5);
  const tage = manuelleTageswerte([k], "2026-10-22", "2026-11-03");
  assert.equal(tage.length, 10);
  assert.equal(tage[0].datum, "2026-10-22");
  assert.equal(tage.at(-1).datum, "2026-10-31");
  assert.equal(Math.round(tage.reduce((s, t) => s + t.ausgaben, 0)), 100);
});
test("Wochenverlauf (Montag, Berlin)", () => {
  assert.equal(wochenMontag("2026-10-28"), "2026-10-26");
  assert.equal(wochenMontag("2026-10-26"), "2026-10-26");
  assert.equal(wochenMontag("2026-11-01"), "2026-10-26"); // Sonntag
  const v = wochenVerlauf(
    [
      { created_at: "2026-10-04T21:30:00Z", quelle: "meta" }, // So 4.10. 23:30 Berlin → Woche 28.9.
      { created_at: "2026-10-04T22:30:00Z", quelle: "meta" }, // Mo 5.10. 00:30 Berlin → Woche 5.10.
      { created_at: "2026-10-06T10:00:00Z", quelle: "manuell" }, // zählt nicht
    ],
    [
      { datum: "2026-10-01", ausgaben: 10 },
      { datum: "2026-10-05", ausgaben: "20.5" },
      { datum: "2026-11-01", ausgaben: 999 }, // außerhalb
    ],
    "2026-10-01",
    "2026-10-31",
  );
  assert.equal(v[0].woche, "2026-09-28");
  assert.equal(v[0].label, "ab 28.09.");
  assert.equal(v.length, 5);
  assert.deepEqual([v[0].leads, v[0].ausgaben], [1, 10]);
  assert.deepEqual([v[1].leads, v[1].ausgaben], [1, 20.5]);
  assert.equal(v.reduce((s, p) => s + p.ausgaben, 0), 30.5);
});

console.log("Meta-Insights");
test("actions → Leads: „lead“ hat Vorrang, Unterarten nie addieren", () => {
  assert.equal(
    leadsAusAktionen([
      { action_type: "link_click", value: "40" },
      { action_type: "onsite_conversion.lead_grouped", value: "7" },
      { action_type: "leadgen_grouped", value: "7" },
      { action_type: "lead", value: "7" },
    ]),
    7,
  );
  assert.equal(leadsAusAktionen([{ action_type: "onsite_conversion.lead_grouped", value: "3" }]), 3);
  assert.equal(leadsAusAktionen([{ action_type: "offsite_conversion.fb_pixel_lead", value: "2" }]), 2);
  assert.equal(leadsAusAktionen([{ action_type: "link_click", value: "9" }]), 0);
  assert.equal(leadsAusAktionen(undefined), 0);
  assert.equal(leadsAusAktionen([{ action_type: "lead", value: "abc" }]), 0);
});
test("Insight-Zeile lesen", () => {
  const z = leseMetaInsight({
    date_start: "2026-10-27",
    date_stop: "2026-10-27",
    campaign_id: "120210000000001",
    campaign_name: "Müller Bau – Leads",
    spend: "31.456",
    impressions: "2104",
    clicks: "57",
    actions: [{ action_type: "lead", value: "2" }],
  });
  assert.deepEqual(z, {
    plattform: "meta",
    kampagne_id: "120210000000001",
    kampagne_name: "Müller Bau – Leads",
    datum: "2026-10-27",
    ausgaben: 31.46,
    impressionen: 2104,
    klicks: 57,
    leads_plattform: 2,
  });
  assert.equal(leseMetaInsight({ date_start: "2026-10-27", campaign_id: "" }), null);
  assert.equal(leseMetaInsight({ date_start: "gestern", campaign_id: "1" }), null);
  const leer = leseMetaInsight({ date_start: "2026-10-27", campaign_id: "1" });
  assert.equal(leer.ausgaben, 0);
  assert.equal(leer.leads_plattform, 0);
});
test("Doppelte Tageszeilen zusammenfassen", () => {
  const basis = { plattform: "meta", kampagne_id: "1", kampagne_name: null, datum: "2026-10-01", impressionen: 1, klicks: 1, leads_plattform: 1 };
  const r = fasseZusammen([
    { ...basis, ausgaben: 1.1 },
    { ...basis, ausgaben: 2.2, kampagne_name: "A" },
    { ...basis, datum: "2026-10-02", ausgaben: 5 },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].ausgaben, 3.3);
  assert.equal(r[0].leads_plattform, 2);
  assert.equal(r[0].kampagne_name, "A");
});

console.log("Zuordnung");
const zuo = [
  { company_id: "A", plattform: "meta", kampagne_id: "111", aktiv: true },
  { company_id: "B", plattform: "meta", kampagne_id: "222", aktiv: true },
  { company_id: "B", plattform: "meta", kampagne_id: "333", aktiv: false },
  { company_id: "A", plattform: "google", kampagne_id: "999", aktiv: true },
];
test("IDs normalisieren", () => {
  assert.equal(normalisiereKampagnenId(" 1202 1000 "), "12021000");
  assert.equal(normalisiereKampagnenId("abc"), null);
  assert.equal(normalisiereKampagnenId(""), null);
  assert.equal(normalisiereWerbekonto("123456789"), "act_123456789");
  assert.equal(normalisiereWerbekonto(" act_123456789 "), "act_123456789");
  assert.equal(normalisiereWerbekonto("ACT_123456789"), "act_123456789");
  assert.equal(normalisiereWerbekonto("act_x"), null);
});
test("Prüfung: neue, eigene, fremde, ungültige Kampagne", () => {
  assert.deepEqual(pruefeZuordnung({ plattform: "meta", kampagne_id: "444", company_id: "A" }, zuo), { ok: true, vorhanden: false });
  assert.deepEqual(pruefeZuordnung({ plattform: "meta", kampagne_id: "111", company_id: "A" }, zuo), { ok: true, vorhanden: true });
  assert.deepEqual(pruefeZuordnung({ plattform: "meta", kampagne_id: "222", company_id: "A" }, zuo), {
    ok: false, grund: "andere_firma", companyId: "B",
  });
  // gleiche ID auf anderer Plattform ist eine andere Kampagne
  assert.deepEqual(pruefeZuordnung({ plattform: "google", kampagne_id: "111", company_id: "B" }, zuo), { ok: true, vorhanden: false });
  assert.equal(pruefeZuordnung({ plattform: "meta", kampagne_id: "x", company_id: "A" }, zuo).ok, false);
  assert.equal(pruefeZuordnung({ plattform: "tiktok", kampagne_id: "123", company_id: "A" }, zuo).ok, false);
});
test("Offene Kampagnen: nicht zugeordnet, aktive zuerst", () => {
  const offen = offeneKampagnen(
    [
      { id: "111", name: "A", status: "ACTIVE" },
      { id: "333", name: "pausiert, aber vergeben", status: "PAUSED" },
      { id: "555", name: "Zeta", status: "PAUSED" },
      { id: "666", name: "Beta", status: "ACTIVE" },
      { id: "777", name: "Alt", status: "ARCHIVED" },
      { id: "999", name: "gleiche ID wie Google", status: "ACTIVE" },
    ],
    zuo,
  );
  assert.deepEqual(offen.map((k) => k.id), ["666", "999", "555", "777"]);
});
const zeile = (kampagne_id, plattform = "meta") => ({
  plattform, kampagne_id, kampagne_name: null, datum: "2026-10-01", ausgaben: 10, impressionen: 0, klicks: 0, leads_plattform: 0,
});
test("Zentrales Konto: nur aktive Zuordnungen, Rest ohne Firma", () => {
  const r = ordneZu([zeile("111"), zeile("222"), zeile("333"), zeile("444")], zuo, null);
  assert.deepEqual(r.zugeordnet.map((z) => [z.kampagne_id, z.company_id]), [["111", "A"], ["222", "B"]]);
  assert.deepEqual(r.ohneFirma, ["444"]);
});
test("Eigenes Konto: alle Kampagnen an die Firma, fremde Zuordnung hat Vorrang", () => {
  const r = ordneZu([zeile("444"), zeile("555"), zeile("222"), zeile("333")], zuo, "C");
  assert.deepEqual(r.zugeordnet.map((z) => [z.kampagne_id, z.company_id]), [["444", "C"], ["555", "C"], ["222", "B"]]);
  assert.deepEqual(r.ohneFirma, []);
});
test("Google-Zeilen über Google-Zuordnung", () => {
  const r = ordneZu([zeile("999", "google"), zeile("111", "google")], zuo, null);
  assert.deepEqual(r.zugeordnet.map((z) => [z.plattform, z.kampagne_id, z.company_id]), [["google", "999", "A"]]);
});

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`);
if (fehler > 0) process.exit(1);
