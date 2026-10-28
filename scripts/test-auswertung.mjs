// Prüft die reine Auswertungs-Logik (Speed-to-Lead, Erreichbarkeit, Termine/No-Shows, Trichter, Tipps).
// Aufruf: node scripts/test-auswertung.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import {
  MIN_STICHPROBE,
  aZeitraumGrenzen,
  ampelQuote,
  ampelSpeed,
  berechneAuswertung,
  berechneErreichbarkeit,
  berechneSpeed,
  berechneTermine,
  berechneTrichter,
  berlin,
  dauerKurz,
  filterLeads,
  heatmapZelle,
  istErreicht,
  kalenderTage,
  leadKontakt,
  leadReise,
  leseAZeitraum,
  median,
  mittel,
  nachfolger,
  offenerVersuch,
  quote,
  speedBucket,
  terminZeit,
  tipps,
  vergleich,
  wartetAufRueckmeldung,
  zuErsetzenderTermin,
  OHNE_KAMPAGNE,
} from "../src/lib/auswertung/logik.ts";

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

const plusMin = (iso, min) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();
let nr = 0;
function lead(over = {}) {
  nr++;
  return {
    id: `l${nr}`,
    created_at: "2026-07-14T08:00:00.000Z",
    status: "neu",
    quelle: "meta",
    kampagne: null,
    first_contact_at: null,
    angebotswert: null,
    auftragswert: null,
    verlust_grund: null,
    wechsel: [],
    name: `Lead ${nr}`,
    ...over,
  };
}
const anruf = (lead_id, am, ergebnis = "erreicht", kanal = "anruf") => ({ lead_id, am, kanal, ergebnis });
const termin = (id, lead_id, over = {}) => ({
  id,
  lead_id,
  art: "vor_ort",
  beginn: "2026-07-20T08:00:00.000Z",
  status: "geplant",
  ersetzt_termin_id: null,
  created_at: "2026-07-15T08:00:00.000Z",
  ...over,
});

console.log("Median, Mittel, Quote");
test("Median ungerade/gerade/leer", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([NaN, 2]), 2);
});
test("Mittel und Quote robust gegen 0", () => {
  assert.equal(mittel([2, 4]), 3);
  assert.equal(mittel([]), null);
  assert.equal(quote(1, 0), null);
  assert.equal(quote(1, 3), 33);
  assert.equal(quote(0, 5), 0);
});

console.log("Speed-Buckets");
test("Grenzen der Buckets", () => {
  assert.equal(speedBucket(0), "u5");
  assert.equal(speedBucket(4.99), "u5");
  assert.equal(speedBucket(5), "5_15");
  assert.equal(speedBucket(14.9), "5_15");
  assert.equal(speedBucket(15), "15_60");
  assert.equal(speedBucket(59), "15_60");
  assert.equal(speedBucket(60), "1_4");
  assert.equal(speedBucket(239), "1_4");
  assert.equal(speedBucket(240), "4_24");
  assert.equal(speedBucket(1439), "4_24");
  assert.equal(speedBucket(1440), "ueber24");
  assert.equal(speedBucket(null), "nie");
  assert.equal(speedBucket(undefined), "nie");
});
test("Speed: Ø, Median, Anteil ≤5/15 Min., nie kontaktiert", () => {
  const a = lead();
  const b = lead();
  const c = lead();
  const d = lead();
  const anrufe = [
    anruf(a.id, plusMin(a.created_at, 2)),
    anruf(b.id, plusMin(b.created_at, 10), "mailbox"),
    anruf(b.id, plusMin(b.created_at, 70), "erreicht"),
    anruf(c.id, plusMin(c.created_at, 120), null, "whatsapp"),
  ];
  const s = berechneSpeed([a, b, c, d], anrufe, new Date("2026-07-15T08:00:00Z"));
  assert.equal(s.ersterVersuch.anzahl, 3);
  assert.equal(s.ersterVersuch.median, 10);
  assert.equal(Math.round(s.ersterVersuch.mittel), 44);
  assert.equal(s.erstesErreichen.anzahl, 2);
  assert.equal(s.erstesErreichen.median, 36);
  assert.equal(s.innerhalb5, 25);
  assert.equal(s.innerhalb15, 50);
  assert.equal(s.nieKontaktiert, 1);
  const nie = s.buckets.find((x) => x.id === "nie");
  assert.equal(nie.anzahl, 1);
  // Langsamste: der nie angerufene offene Lead steht oben
  assert.equal(s.langsamste[0].leadId, d.id);
  assert.equal(s.langsamste[0].nie, true);
});
test("Speed: Abschlussquote je Bucket + Faktor schnell/langsam", () => {
  const leads = [];
  const anrufe = [];
  // 4 schnelle (2 Aufträge), 4 langsame (1 Auftrag)
  for (let i = 0; i < 4; i++) {
    const l = lead({ status: i < 2 ? "gewonnen" : "verloren", auftragswert: i < 2 ? 1000 : null });
    leads.push(l);
    anrufe.push(anruf(l.id, plusMin(l.created_at, 3)));
  }
  for (let i = 0; i < 4; i++) {
    const l = lead({ status: i < 1 ? "gewonnen" : "verloren", auftragswert: i < 1 ? 1000 : null });
    leads.push(l);
    anrufe.push(anruf(l.id, plusMin(l.created_at, 300)));
  }
  const s = berechneSpeed(leads, anrufe);
  assert.equal(s.buckets.find((b) => b.id === "u5").abschlussquote, 50);
  assert.equal(s.buckets.find((b) => b.id === "4_24").abschlussquote, 25);
  assert.equal(s.faktorSchnell, 2);
  assert.equal(s.quoteSchnell, 50);
});
test("Speed: Faktor null bei zu kleiner Stichprobe", () => {
  const l = lead({ status: "gewonnen" });
  const s = berechneSpeed([l], [anruf(l.id, plusMin(l.created_at, 1))]);
  assert.equal(s.faktorSchnell, null);
});
test("Speed: Anruf vor Eingang (von Hand angelegt) zählt als 0 Min.", () => {
  const l = lead();
  const s = berechneSpeed([l], [anruf(l.id, plusMin(l.created_at, -5))]);
  assert.equal(s.ersterVersuch.median, 0);
});
test("Speed: Altdaten ohne Versuche nutzen first_contact_at / Statuswechsel", () => {
  const l = lead({ first_contact_at: plusMin("2026-07-14T08:00:00.000Z", 30), status: "kontaktiert", wechsel: [{ am: plusMin("2026-07-14T08:00:00.000Z", 30), neu_status: "kontaktiert" }] });
  const k = leadKontakt(l, []);
  assert.equal(k.ersterVersuch, l.first_contact_at);
  assert.equal(k.erstesErreichen, l.first_contact_at);
});
test("Speed: Reaktionszeit nach Eingangs-Wochentag und Tageszeit", () => {
  // Dienstag 10 Uhr Berlin (Sommer) → morgen; Samstag 19 Uhr → abend/Wochenende
  const di = lead({ created_at: "2026-07-14T08:00:00.000Z" });
  const sa = lead({ created_at: "2026-07-18T17:00:00.000Z" });
  const s = berechneSpeed([di, sa], [anruf(di.id, plusMin(di.created_at, 4)), anruf(sa.id, plusMin(sa.created_at, 600))]);
  assert.equal(s.nachWochentag[1].median, 4);
  assert.equal(s.nachWochentag[5].median, 600);
  assert.equal(s.nachTageszeit.find((x) => x.id === "morgen").anzahl, 1);
  assert.equal(s.nachTageszeit.find((x) => x.id === "abend").anzahl, 1);
  assert.equal(s.werktag.median, 4);
  assert.equal(s.wochenende.median, 600);
});

console.log("Berliner Zeit, Heatmap (Sommer-/Winterzeit)");
test("Sommerzeit: 15:30 UTC = Dienstag 17 Uhr", () => {
  assert.deepEqual(heatmapZelle("2026-07-14T15:30:00Z"), { tag: 1, stunde: 17, index: 10 });
});
test("Winterzeit: 15:30 UTC = Dienstag 16 Uhr", () => {
  assert.deepEqual(heatmapZelle("2026-01-13T15:30:00Z"), { tag: 1, stunde: 16, index: 9 });
});
test("Wochentagswechsel um Mitternacht Berlin (So 23:30 UTC = Mo 0:30)", () => {
  const b = berlin("2026-01-11T23:30:00Z");
  assert.equal(b.tag, 0);
  assert.equal(b.h, 0);
  assert.equal(heatmapZelle("2026-01-11T23:30:00Z"), null);
});
test("Umstellungstage März/Oktober", () => {
  assert.equal(berlin("2026-03-29T01:30:00Z").h, 3);
  assert.equal(berlin("2026-03-29T00:30:00Z").h, 1);
  assert.equal(berlin("2026-10-25T00:30:00Z").h, 2);
  assert.equal(berlin("2026-10-25T01:30:00Z").h, 2);
  assert.equal(berlin("2026-10-25T01:30:00Z").tag, 6);
});
test("kalenderTage über Zeitumstellung und Mitternacht", () => {
  assert.equal(kalenderTage("2026-03-28T22:30:00Z", "2026-03-29T21:30:00Z"), 1); // Sa 23:30 CET → So 23:30 CEST
  assert.equal(kalenderTage("2026-03-28T23:30:00Z", "2026-03-29T21:30:00Z"), 0); // So 0:30 CET → So 23:30 CEST
  assert.equal(kalenderTage("2026-07-14T21:59:00Z", "2026-07-14T22:01:00Z"), 1);
  assert.equal(kalenderTage("2026-07-14T08:00:00Z", "2026-07-21T08:00:00Z"), 7);
});
test("Heatmap: Zuordnung und Quote je Zelle, Mindest-Stichprobe", () => {
  const anrufe = [];
  // 5× Dienstag 17 Uhr (Sommer), 4 erreicht
  for (let i = 0; i < 5; i++) anrufe.push(anruf(`h${i}`, `2026-07-14T15:${10 + i}:00Z`, i < 4 ? "erreicht" : "mailbox"));
  // 2× Montag 8 Uhr Winterzeit (07:xx UTC), nicht erreicht
  anrufe.push(anruf("m1", "2026-01-12T07:05:00Z", "nicht_erreicht"));
  anrufe.push(anruf("m2", "2026-01-12T07:15:00Z", "falsche_nummer"));
  // außerhalb 7–21 Uhr, ohne Ergebnis, WhatsApp
  anrufe.push(anruf("x1", "2026-07-14T20:30:00Z", "erreicht")); // 22:30 Berlin
  anrufe.push(anruf("x2", "2026-07-14T10:00:00Z", null));
  anrufe.push(anruf("x3", "2026-07-14T10:00:00Z", null, "whatsapp"));
  const e = berechneErreichbarkeit(anrufe);
  const di17 = e.heatmap[1][10];
  assert.equal(di17.versuche, 5);
  assert.equal(di17.erreicht, 4);
  assert.equal(di17.quote, 80);
  assert.equal(di17.genug, true);
  const mo8 = e.heatmap[0][1];
  assert.equal(mo8.versuche, 2);
  assert.equal(mo8.genug, false);
  assert.equal(e.gesamt.versuche, 8);
  assert.equal(e.gesamt.erreicht, 5);
  assert.equal(e.gesamt.ohneErgebnis, 1);
  assert.equal(e.gesamt.whatsapp, 1);
  assert.equal(e.gesamt.ausserhalb, 1);
  assert.equal(e.gesamt.mailbox, 1);
  assert.equal(e.gesamt.falscheNummer, 1);
  assert.equal(e.gesamt.mailboxAnteil, 13);
  // Beste Zeit nur aus belastbaren Slots (≥ MIN_STICHPROBE)
  assert.equal(MIN_STICHPROBE, 5);
  assert.equal(e.beste.length, 1);
  assert.equal(e.beste[0].text, "dienstags 17–19 Uhr");
  assert.equal(e.schlechteste.length, 0);
  assert.equal(e.proTag[1].versuche, 6); // inkl. 22:30-Anruf
  assert.equal(e.proBlock[5].versuche, 5);
});
test("Rückruf gewünscht zählt als erreicht", () => {
  assert.equal(istErreicht("rueckruf_gewuenscht"), true);
  assert.equal(istErreicht("mailbox"), false);
  assert.equal(istErreicht(null), false);
});

console.log("Versuche bis Erreichen, Quote nach Versuch Nr.");
test("Versuch-Nummern je Lead, nur bis zum ersten Erreichen", () => {
  const anrufe = [
    // A: 1. Versuch erreicht, danach Folgeanruf (zählt nicht mehr)
    anruf("A", "2026-07-14T08:00:00Z", "erreicht"),
    anruf("A", "2026-07-15T08:00:00Z", "nicht_erreicht"),
    // B: Mailbox, nicht erreicht, erreicht (3. Versuch) — unsortiert übergeben
    anruf("B", "2026-07-14T10:00:00Z", "erreicht"),
    anruf("B", "2026-07-14T08:00:00Z", "mailbox"),
    anruf("B", "2026-07-14T09:00:00Z", "nicht_erreicht"),
    // C: 5 Versuche, 5. erreicht → „4. und später“
    ...[0, 1, 2, 3].map((i) => anruf("C", `2026-07-1${4 + i}T08:00:00Z`, "nicht_erreicht")),
    anruf("C", "2026-07-18T08:00:00Z", "erreicht"),
    // D: nie erreicht; WhatsApp zählt nicht als Anrufversuch
    anruf("D", "2026-07-14T08:00:00Z", null, "whatsapp"),
    anruf("D", "2026-07-14T09:00:00Z", "mailbox"),
  ];
  const e = berechneErreichbarkeit(anrufe);
  const v = e.versucheBisErreichen;
  assert.equal(v.erreichteLeads, 3);
  assert.equal(v.nieErreicht, 1);
  assert.deepEqual(v.verteilung.map((x) => x.anzahl), [1, 0, 1, 1]);
  assert.equal(v.mittel, 3);
  const q = e.quoteNachVersuch;
  assert.equal(q[0].versuche, 4); // A, B, C, D je 1. Versuch
  assert.equal(q[0].erreicht, 1);
  assert.equal(q[2].versuche, 2); // B, C
  assert.equal(q[2].erreicht, 1);
  assert.equal(q[3].versuche, 2); // C: 4. und 5. Versuch
  assert.equal(q[3].erreicht, 1);
  const k = leadKontakt(lead({ id: "B" }), anrufe.filter((a) => a.lead_id === "B"));
  assert.equal(k.versuchBisErreichen, 3);
  assert.equal(k.anrufVersuche, 3);
});

console.log("Termine, No-Shows, Recovery-Kette");
test("Show-Rate, No-Show-Rate, offene Rückmeldung", () => {
  const jetzt = new Date("2026-07-25T12:00:00Z");
  const leads = ["a", "b", "c", "d", "e"].map((id) => lead({ id, status: "vor_ort_termin" }));
  const termine = [
    termin("t1", "a", { status: "stattgefunden" }),
    termin("t2", "b", { status: "stattgefunden" }),
    termin("t3", "c", { status: "nicht_erschienen" }),
    termin("t4", "d", { status: "abgesagt" }),
    termin("t5", "e", { status: "geplant", beginn: "2026-07-24T08:00:00Z" }), // vorbei → wartet
    termin("t6", "e", { status: "geplant", beginn: "2026-07-30T08:00:00Z" }), // anstehend
    termin("fremd", "zzz", { status: "stattgefunden" }), // anderer Lead (nicht in Kohorte)
  ];
  const r = berechneTermine(termine, leads, jetzt);
  assert.equal(r.gesamt, 6);
  assert.equal(r.entschieden, 3);
  assert.equal(r.showRate, 67);
  assert.equal(r.noShowRate, 33);
  assert.equal(r.ohneRueckmeldung, 1);
  assert.equal(r.anstehend, 1);
  assert.equal(r.wartend[0].terminId, "t5");
  assert.equal(r.zaehler.abgesagt, 1);
  assert.equal(wartetAufRueckmeldung({ status: "geplant", beginn: "2026-07-25T11:59:00Z" }, jetzt), true);
  assert.equal(wartetAufRueckmeldung({ status: "stattgefunden", beginn: "2026-07-25T11:59:00Z" }, jetzt), false);
});
test("No-Show nach Wochentag, Uhrzeit, Vorlauf", () => {
  const leads = ["a", "b"].map((id) => lead({ id }));
  const termine = [
    // Montag 20.07.2026 10 Uhr Berlin (08 UTC), am Vortag vereinbart → No-Show
    termin("t1", "a", { status: "nicht_erschienen", beginn: "2026-07-20T08:00:00Z", created_at: "2026-07-19T08:00:00Z" }),
    // Montag 20.07. 17 Uhr Berlin, 10 Tage Vorlauf → stattgefunden
    termin("t2", "b", { status: "stattgefunden", beginn: "2026-07-20T15:00:00Z", created_at: "2026-07-10T08:00:00Z" }),
  ];
  const r = berechneTermine(termine, leads);
  assert.equal(r.nachWochentag[0].entschieden, 2);
  assert.equal(r.nachWochentag[0].noShows, 1);
  assert.equal(r.nachWochentag[0].noShowQuote, 50);
  assert.equal(r.nachWochentag[0].genug, false);
  assert.equal(r.nachUhrzeit[1].noShows, 1); // 10–13 Uhr
  assert.equal(r.nachUhrzeit[3].entschieden, 1); // 16–19 Uhr
  assert.equal(r.nachVorlauf[1].noShows, 1); // 1 Tag vorher
  assert.equal(r.nachVorlauf[4].entschieden, 1); // mehr als 7 Tage
});
test("Recovery: No-Show → verschoben → stattgefunden → Auftrag (mehrstufige Kette)", () => {
  const leads = [lead({ id: "a", status: "gewonnen", auftragswert: 5000 }), lead({ id: "b", status: "kontaktiert" }), lead({ id: "c", status: "verloren", verlust_grund: "zu_teuer" })];
  const termine = [
    termin("a1", "a", { status: "nicht_erschienen", beginn: "2026-07-20T08:00:00Z" }),
    termin("a2", "a", { status: "verschoben", ersetzt_termin_id: "a1", beginn: "2026-07-22T08:00:00Z", created_at: "2026-07-20T10:00:00Z" }),
    termin("a3", "a", { status: "stattgefunden", ersetzt_termin_id: "a2", beginn: "2026-07-24T08:00:00Z", created_at: "2026-07-22T07:00:00Z" }),
    termin("b1", "b", { status: "nicht_erschienen", beginn: "2026-07-21T08:00:00Z" }), // offen → zurückholen
    termin("c1", "c", { status: "nicht_erschienen", beginn: "2026-07-21T08:00:00Z" }), // verloren → nicht offen
  ];
  assert.deepEqual(nachfolger("a1", termine).map((t) => t.id).sort(), ["a2", "a3"]);
  const r = berechneTermine(termine, leads);
  assert.equal(r.recovery.noShows, 3);
  assert.equal(r.recovery.mitNeuemTermin, 1);
  assert.equal(r.recovery.neuerTerminQuote, 33);
  assert.equal(r.recovery.stattgefunden, 1);
  assert.equal(r.recovery.stattgefundenQuote, 100);
  assert.equal(r.recovery.auftrag, 1);
  assert.deepEqual(r.offeneNoShows.map((x) => x.terminId), ["b1"]);
});
test("Recovery: Zyklus in ersetzt_termin_id hängt nicht", () => {
  const termine = [termin("x", "a", { ersetzt_termin_id: "y" }), termin("y", "a", { ersetzt_termin_id: "x" })];
  assert.deepEqual(nachfolger("x", termine).map((t) => t.id), ["y"]);
});
test("zuErsetzenderTermin: jüngster No-Show/verschobener ohne Nachfolger", () => {
  const t = [
    termin("alt", "a", { status: "nicht_erschienen", beginn: "2026-07-10T08:00:00Z" }),
    termin("neu", "a", { status: "nicht_erschienen", beginn: "2026-07-20T08:00:00Z" }),
    termin("ok", "a", { status: "stattgefunden", beginn: "2026-07-25T08:00:00Z" }),
  ];
  assert.equal(zuErsetzenderTermin(t).id, "neu");
  assert.equal(zuErsetzenderTermin([...t, termin("n2", "a", { ersetzt_termin_id: "neu" })]).id, "alt");
  assert.equal(zuErsetzenderTermin([termin("g", "a")]), null);
});

console.log("Trichter von A bis Z");
test("Trichter monoton, Quoten zum Vorschritt/Start, Umsatz, Verlustgründe", () => {
  const t0 = "2026-07-14T08:00:00.000Z";
  const a = lead({ id: "a", status: "gewonnen", auftragswert: 6000, angebotswert: 6500, wechsel: [
    { am: plusMin(t0, 10), neu_status: "kontaktiert" },
    { am: plusMin(t0, 60), neu_status: "vor_ort_termin" },
    { am: plusMin(t0, 3000), neu_status: "angebot_raus" },
    { am: plusMin(t0, 6000), neu_status: "gewonnen" },
  ] });
  const b = lead({ id: "b", status: "angebot_raus", angebotswert: 2000 });
  const c = lead({ id: "c", status: "kontaktiert" });
  const d = lead({ id: "d", status: "neu" });
  const e = lead({ id: "e", status: "verloren", verlust_grund: "zu_teuer" });
  const f = lead({ id: "f", status: "nicht_erreicht" });
  const anrufe = [
    anruf("a", plusMin(t0, 5), "mailbox"),
    anruf("a", plusMin(t0, 10), "erreicht"),
    anruf("c", plusMin(t0, 20), "erreicht"),
    anruf("e", plusMin(t0, 30), "nicht_erreicht"),
  ];
  const termine = [termin("ta", "a", { status: "stattgefunden", created_at: plusMin(t0, 60), beginn: plusMin(t0, 1440) })];
  const tr = berechneTrichter([a, b, c, d, e, f], anrufe, termine);
  const n = Object.fromEntries(tr.stufen.map((s) => [s.id, s.anzahl]));
  assert.deepEqual(n, { anfragen: 6, kontaktiert: 4, erreicht: 3, termin: 2, stattgefunden: 2, angebot: 2, auftrag: 1 });
  for (let i = 1; i < tr.stufen.length; i++) assert.ok(tr.stufen[i].anzahl <= tr.stufen[i - 1].anzahl, "monoton");
  const st = Object.fromEntries(tr.stufen.map((s) => [s.id, s]));
  assert.equal(st.erreicht.quoteVorschritt, 75);
  assert.equal(st.auftrag.quoteStart, 17);
  assert.equal(st.kontaktiert.dauerMittel, (5 + 20 + 30) / 3); // a, c, e (erster Versuch)
  assert.equal(st.kontaktiert.dauerMedian, 20);
  assert.equal(tr.umsatz, 6000);
  assert.equal(tr.auftragswertMittel, 6000);
  assert.equal(tr.angebote, 2);
  assert.equal(tr.angeboteSumme, 8500);
  assert.equal(tr.angebotsAbschlussquote, 50);
  assert.equal(tr.abschlussquote, 17);
  assert.equal(tr.verloren, 2);
  assert.deepEqual(tr.verlustGruende.map((g) => g.grund).sort(), ["Nicht erreicht", "Zu teuer"]);
  assert.equal(tr.verlustGruende[0].anteil, 50);
  // Dauer Termin → stattgefunden: 1440 − 60 Min.
  assert.equal(st.stattgefunden.dauerMittel, 1380);
});
test("leadReise: Auftrag ohne protokollierte Zwischenschritte füllt Trichter auf", () => {
  const r = leadReise(lead({ status: "gewonnen", auftragswert: 100 }), [], []);
  assert.deepEqual(r.flags, [true, true, true, true, true, true, true]);
});

console.log("Vergleich, Filter, Ampel, Zeitraum");
test("Vergleich je Quelle", () => {
  const l1 = lead({ id: "q1", quelle: "meta", status: "gewonnen", auftragswert: 1000 });
  const l2 = lead({ id: "q2", quelle: "meta" });
  const l3 = lead({ id: "q3", quelle: "google_ads" });
  const z = vergleich([l1, l2, l3], [anruf("q1", plusMin(l1.created_at, 4)), anruf("q2", plusMin(l2.created_at, 8), "mailbox")], [], (l) => l.quelle);
  const meta = z.find((x) => x.schluessel === "meta");
  assert.equal(z[0].schluessel, "meta");
  assert.equal(meta.anfragen, 2);
  assert.equal(meta.erreichtQuote, 50);
  assert.equal(meta.anrufQuote, 50);
  assert.equal(meta.speedMedian, 6);
  assert.equal(meta.abschlussquote, 50);
  assert.equal(meta.umsatz, 1000);
  assert.equal(z.find((x) => x.schluessel === "google_ads").speedMedian, null);
});
test("Filter Quelle/Kampagne inkl. „ohne Kampagne“", () => {
  const ls = [lead({ quelle: "meta", kampagne: "K1" }), lead({ quelle: "meta", kampagne: null }), lead({ quelle: "google_ads", kampagne: "K1" })];
  assert.equal(filterLeads(ls, { quelle: "meta" }).length, 2);
  assert.equal(filterLeads(ls, { kampagne: "K1" }).length, 2);
  assert.equal(filterLeads(ls, { kampagne: OHNE_KAMPAGNE }).length, 1);
  assert.equal(filterLeads(ls, { quelle: "alle", kampagne: "alle" }).length, 3);
});
test("Ampeln", () => {
  assert.equal(ampelSpeed(null), "grau");
  assert.equal(ampelSpeed(10), "gruen");
  assert.equal(ampelSpeed(30), "gelb");
  assert.equal(ampelSpeed(90), "rot");
  assert.equal(ampelQuote(80, 70, 50), "gruen");
  assert.equal(ampelQuote(50, 70, 50), "gelb");
  assert.equal(ampelQuote(10, 70, 50), "rot");
  assert.equal(ampelQuote(null, 70, 50), "grau");
});
test("Zeiträume in Berliner Zeit", () => {
  const jetzt = new Date("2026-07-14T10:00:00Z");
  assert.equal(aZeitraumGrenzen("7", jetzt).von.toISOString(), "2026-07-07T22:00:00.000Z");
  assert.equal(aZeitraumGrenzen("monat", jetzt).von.toISOString(), "2026-06-30T22:00:00.000Z");
  assert.equal(aZeitraumGrenzen("jahr", jetzt).von.toISOString(), "2025-12-31T23:00:00.000Z");
  assert.equal(leseAZeitraum("jahr"), "jahr");
  assert.equal(leseAZeitraum("quatsch"), "30");
  assert.equal(leseAZeitraum(["90"]), "90");
});

console.log("Erfassung: offener Versuch, Termin-Schnellwahl");
test("offenerVersuch: jüngster Anruf ohne Ergebnis aus den letzten 3 Std.", () => {
  const jetzt = new Date("2026-07-14T12:00:00Z");
  const liste = [
    { id: "alt", am: "2026-07-14T08:00:00Z", kanal: "anruf", ergebnis: null },
    { id: "neu", am: "2026-07-14T11:50:00Z", kanal: "anruf", ergebnis: null },
    { id: "fertig", am: "2026-07-14T11:55:00Z", kanal: "anruf", ergebnis: "mailbox" },
    { id: "wa", am: "2026-07-14T11:58:00Z", kanal: "whatsapp", ergebnis: null },
  ];
  assert.equal(offenerVersuch(liste, jetzt).id, "neu");
  assert.equal(offenerVersuch(liste.slice(0, 1), jetzt), null);
});
test("terminZeit: morgen 10 Uhr Berlin über die Zeitumstellung", () => {
  assert.equal(terminZeit(1, "10:00", new Date("2026-10-24T10:00:00Z")).toISOString(), "2026-10-25T09:00:00.000Z");
  assert.equal(terminZeit(0, "14:30", new Date("2026-07-14T06:00:00Z")).toISOString(), "2026-07-14T12:30:00.000Z");
  assert.equal(terminZeit(0, "25:00"), null);
});

console.log("Klartext-Tipps");
function basis() {
  return berechneAuswertung({ leads: [], anrufe: [], termine: [] });
}
test("Keine Daten → keine Tipps, keine Fehler", () => {
  const a = basis();
  assert.deepEqual(a.tipps, []);
  assert.equal(a.trichter.abschlussquote, null);
  assert.equal(a.speed.innerhalb5, null);
  assert.equal(a.termine.showRate, null);
});
test("Tipp: langsam + Faktor, offene No-Shows, beste/schlechteste Zeit", () => {
  const leads = [];
  const anrufe = [];
  const termine = [];
  // 3 schnelle Aufträge, 6 langsame Verluste (Median > 15 Min.)
  for (let i = 0; i < 3; i++) {
    const l = lead({ status: "gewonnen", auftragswert: 1000 });
    leads.push(l);
    anrufe.push(anruf(l.id, plusMin(l.created_at, 2)));
  }
  for (let i = 0; i < 6; i++) {
    const l = lead({ status: i === 0 ? "gewonnen" : "kontaktiert", auftragswert: i === 0 ? 500 : null });
    leads.push(l);
    anrufe.push(anruf(l.id, plusMin(l.created_at, 120)));
  }
  // Erreichbarkeit: Di 17–19 Uhr gut (5/5), Mo 8–10 Uhr schlecht (0/5)
  // (nach dem ersten Anruf, damit die Reaktionszeit unverändert bleibt)
  for (let i = 0; i < 5; i++) anrufe.push(anruf(leads[i + 3].id, `2026-07-21T15:0${i}:00Z`, "erreicht"));
  for (let i = 0; i < 5; i++) anrufe.push(anruf(leads[i + 3].id, `2026-07-20T06:3${i}:00Z`, "nicht_erreicht"));
  // offener No-Show
  termine.push(termin("ns", leads[5].id, { status: "nicht_erschienen" }));
  const a = berechneAuswertung({ leads, anrufe, termine, jetzt: new Date("2026-07-28T12:00:00Z") });
  const ids = a.tipps.map((t) => t.id);
  assert.equal(ids[0], "noshow_offen");
  assert.ok(ids.includes("speed_faktor"), ids.join(","));
  assert.ok(ids.includes("beste_zeit"));
  assert.ok(ids.includes("schlechteste_zeit"));
  const text = a.tipps.map((t) => t.text).join(" | ");
  assert.match(text, /1 No-Show wartet auf einen Rückruf/);
  assert.match(text, /Du rufst im Schnitt nach 2 Std\. an/);
  assert.match(text, /werden \d+(,\d)?-mal so oft zum Auftrag/);
  assert.match(text, /Am besten erreichst du Leads dienstags \d+–\d+ Uhr \(100 % erreicht\)/);
  assert.match(text, /Montags 7–9 Uhr erreichst du fast niemanden \(0 %\)/);
  assert.ok(a.tipps.length <= 6);
});
test("Tipp: schnelle Reaktion wird gelobt, hohe No-Show-Quote gewarnt", () => {
  const leads = [];
  const anrufe = [];
  const termine = [];
  for (let i = 0; i < 6; i++) {
    const l = lead({ status: "angebot_raus" });
    leads.push(l);
    anrufe.push(anruf(l.id, plusMin(l.created_at, 1)));
    termine.push(termin(`t${i}`, l.id, { status: i < 3 ? "nicht_erschienen" : "stattgefunden" }));
    if (i < 3) termine.push(termin(`r${i}`, l.id, { status: "geplant", ersetzt_termin_id: `t${i}`, beginn: "2026-08-30T08:00:00Z" }));
  }
  const t = tipps(berechneAuswertung({ leads, anrufe, termine, jetzt: new Date("2026-07-28T12:00:00Z") }));
  const ids = t.map((x) => x.id);
  assert.ok(ids.includes("speed_gut"), ids.join(","));
  assert.ok(ids.includes("noshow_quote"));
  assert.ok(!ids.includes("noshow_offen"));
});
test("dauerKurz", () => {
  assert.equal(dauerKurz(null), "—");
  assert.equal(dauerKurz(4.4), "4 Min.");
  assert.equal(dauerKurz(125), "2 Std. 5 Min.");
  assert.equal(dauerKurz(600), "10 Std.");
  assert.equal(dauerKurz(1440 * 3), "3 Tage");
});

console.log(`\n${ok} ok, ${fehler} fehlgeschlagen`);
if (fehler > 0) process.exit(1);
