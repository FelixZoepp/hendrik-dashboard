// Prüft die reine Masterclass-Logik (Fortschritt, Freischaltung, Video-Einbettung, HTML-Filter).
// Aufruf: node scripts/test-masterclass.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import {
  bereinigeHtml,
  fortschritt,
  fortschrittJePerson,
  istSpeicherPfad,
  lektionSperre,
  lernreihenfolge,
  markdownZuHtml,
  modulFortschritt,
  modulSperren,
  nachbarn,
  nachKapiteln,
  normalisiereAnhaenge,
  normalisiereLektion,
  normalisiereModul,
  parseZeitmarken,
  sichererDateiname,
  sichtbarerKatalog,
  tageSeit,
  verschiebe,
  videoEinbettung,
  weiterLektion,
  zeitmarkenText,
} from "../src/lib/masterclass/logik.ts";

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

const modul = (id, reihenfolge, extra = {}) => normalisiereModul({ id, titel: `Modul ${id}`, reihenfolge, ...extra });
const lektion = (id, course_id, reihenfolge, extra = {}) =>
  normalisiereLektion({ id, course_id, titel: `Lektion ${id}`, reihenfolge, ...extra });

console.log("Normalisieren");
test("Alte Zeilen ohne neue Spalten: veröffentlicht, Video, keine Anhänge", () => {
  const m = normalisiereModul({ id: "m1", titel: "Leadbearbeitung Basics", beschreibung: "x", reihenfolge: 1 });
  assert.equal(m.status, "veroeffentlicht");
  assert.equal(m.voraussetzung_course_id, null);
  const l = normalisiereLektion({ id: "l1", course_id: "m1", titel: "A", dauer: 8, reihenfolge: 1, freigeschaltet_ab: 3 });
  assert.equal(l.status, "veroeffentlicht");
  assert.equal(l.typ, "video");
  assert.deepEqual(l.anhaenge, []);
  assert.equal(l.freigeschaltet_ab, 3);
});
test("Entwurf bleibt Entwurf", () => {
  assert.equal(normalisiereModul({ id: "m", titel: "x", status: "entwurf" }).status, "entwurf");
  assert.equal(normalisiereLektion({ id: "l", course_id: "m", titel: "x", status: "entwurf" }).status, "entwurf");
});
test("Anhänge: unsichere Links und Pfade fallen weg", () => {
  const a = normalisiereAnhaenge([
    { name: "Leitfaden", pfad: "lektionen/abc/leitfaden.pdf" },
    { name: "Seite", url: "https://example.org/x" },
    { name: "Böse", url: "javascript:alert(1)" },
    { name: "Ausbruch", pfad: "../geheim/x.pdf" },
    { url: "https://ohne-name.de" },
    "quatsch",
  ]);
  assert.deepEqual(a, [
    { name: "Leitfaden", pfad: "lektionen/abc/leitfaden.pdf" },
    { name: "Seite", url: "https://example.org/x" },
  ]);
  assert.equal(normalisiereAnhaenge(null).length, 0);
});

console.log("Katalog & Reihenfolge");
const M = [modul("b", 2), modul("a", 1), modul("e", 3, { status: "entwurf" })];
const L = [
  lektion("a2", "a", 2),
  lektion("a1", "a", 1),
  lektion("b1", "b", 1),
  lektion("b2", "b", 2, { status: "entwurf" }),
  lektion("e1", "e", 1),
];
test("Kunden sehen nur Veröffentlichtes", () => {
  const k = sichtbarerKatalog(M, L);
  assert.deepEqual(k.module.map((m) => m.id), ["a", "b"]);
  assert.deepEqual(k.lektionen.map((l) => l.id).sort(), ["a1", "a2", "b1"]);
});
test("Lernreihenfolge Modul für Modul", () => {
  const k = sichtbarerKatalog(M, L);
  assert.deepEqual(lernreihenfolge(k.module, k.lektionen).map((l) => l.id), ["a1", "a2", "b1"]);
});
test("Nachbarn (Zurück/Weiter)", () => {
  const g = lernreihenfolge(...Object.values(sichtbarerKatalog(M, L)));
  const n = nachbarn(g, "a2");
  assert.equal(n.vorher.id, "a1");
  assert.equal(n.nachher.id, "b1");
  assert.equal(nachbarn(g, "a1").vorher, null);
  assert.equal(nachbarn(g, "b1").nachher, null);
});
test("Kapitel gruppieren", () => {
  const ls = [
    lektion("1", "a", 1, { kapitel: "Grundlagen" }),
    lektion("2", "a", 2, { kapitel: "Grundlagen" }),
    lektion("3", "a", 3, { kapitel: "Praxis" }),
    lektion("4", "a", 4),
  ];
  assert.deepEqual(
    nachKapiteln(ls).map((g) => [g.kapitel, g.lektionen.length]),
    [["Grundlagen", 2], ["Praxis", 1], [null, 1]],
  );
});
test("Verschieben hoch/runter", () => {
  assert.deepEqual(verschiebe(["x", "y", "z"], "z", "hoch"), [
    { id: "x", reihenfolge: 1 },
    { id: "z", reihenfolge: 2 },
    { id: "y", reihenfolge: 3 },
  ]);
  assert.deepEqual(verschiebe(["x", "y"], "x", "hoch").map((e) => e.id), ["x", "y"]);
  assert.deepEqual(verschiebe(["x", "y"], "y", "runter").map((e) => e.id), ["x", "y"]);
});

console.log("Fortschritt");
test("Prozent und leere Module", () => {
  assert.deepEqual(fortschritt(["a", "b", "c"], new Set(["a"])), { erledigt: 1, gesamt: 3, prozent: 33 });
  assert.deepEqual(fortschritt([], new Set(["a"])), { erledigt: 0, gesamt: 0, prozent: 0 });
  assert.equal(fortschritt(["a", "b"], new Set(["a", "b", "x"])).prozent, 100);
});
test("Modul-Fortschritt zählt nur Lektionen des Moduls", () => {
  const k = sichtbarerKatalog(M, L);
  assert.deepEqual(modulFortschritt("a", k.lektionen, new Set(["a1", "b1"])), { erledigt: 1, gesamt: 2, prozent: 50 });
});
test("Fortschritt je Person, Einträge zu Entwürfen zählen nicht", () => {
  const p = fortschrittJePerson(
    ["u1", "u2"],
    [
      { user_id: "u1", lesson_id: "a1", abgeschlossen_am: "2026-10-01T10:00:00Z" },
      { user_id: "u1", lesson_id: "a2", abgeschlossen_am: "2026-10-03T10:00:00Z" },
      { user_id: "u1", lesson_id: "b2", abgeschlossen_am: "2026-10-05T10:00:00Z" },
      { user_id: "u3", lesson_id: "a1", abgeschlossen_am: "2026-10-01T10:00:00Z" },
    ],
    ["a1", "a2", "b1"],
  );
  assert.equal(p[0].erledigt, 2);
  assert.equal(p[0].prozent, 67);
  assert.equal(p[0].zuletzt, "2026-10-03T10:00:00Z");
  assert.equal(p[1].erledigt, 0);
  assert.equal(p[1].zuletzt, null);
});
test("Weiter, wo du warst", () => {
  const g = [lektion("1", "a", 1), lektion("2", "a", 2), lektion("3", "a", 3), lektion("4", "b", 1)];
  const keins = new Set();
  assert.equal(weiterLektion(g, new Map(), keins).id, "1");
  assert.equal(weiterLektion(g, new Map([["1", "2026-10-01"]]), keins).id, "2");
  // zuletzt Lektion 3 erledigt → weiter mit 4, nicht mit der übersprungenen 2
  assert.equal(weiterLektion(g, new Map([["1", "2026-10-01"], ["3", "2026-10-02"]]), keins).id, "4");
  // nach dem Ende → erste offene
  assert.equal(weiterLektion(g, new Map([["1", "2026-10-01"], ["4", "2026-10-03"]]), keins).id, "2");
  // gesperrte überspringen
  assert.equal(weiterLektion(g, new Map(), new Set(["1", "2"])).id, "3");
  const alle = new Map(g.map((l) => [l.id, "2026-10-01"]));
  assert.equal(weiterLektion(g, alle, keins), null);
});

console.log("Freischaltung");
const MS = [modul("start", 1), modul("tel", 2, { voraussetzung_course_id: "start" }), modul("preis", 3)];
const LS = [lektion("s1", "start", 1), lektion("s2", "start", 2), lektion("t1", "tel", 1), lektion("p1", "preis", 1)];
test("Standard: alle Module frei, außer Reihenfolge-Sperre", () => {
  const s = modulSperren(MS, LS, new Set(), {});
  assert.equal(s.get("start").gesperrt, false);
  assert.equal(s.get("preis").gesperrt, false);
  assert.equal(s.get("tel").gesperrt, true);
  assert.equal(s.get("tel").grund, "voraussetzung");
  assert.match(s.get("tel").hinweis, /Modul start/);
});
test("Reihenfolge-Sperre fällt, wenn Vor-Modul komplett erledigt", () => {
  assert.equal(modulSperren(MS, LS, new Set(["s1"]), {}).get("tel").gesperrt, true);
  assert.equal(modulSperren(MS, LS, new Set(["s1", "s2"]), {}).get("tel").gesperrt, false);
});
test("Firma gezielt gesperrt / gezielt freigeschaltet", () => {
  const s = modulSperren(MS, LS, new Set(), { preis: false, tel: true });
  assert.equal(s.get("preis").gesperrt, true);
  assert.equal(s.get("preis").grund, "firma");
  assert.equal(s.get("tel").gesperrt, false, "Freischaltung übersteuert Voraussetzung");
  assert.equal(modulSperren(MS, LS, new Set(["s1", "s2"]), { tel: false }).get("tel").grund, "firma");
});
test("Unsichtbares oder leeres Vor-Modul sperrt nicht", () => {
  const ohne = modulSperren([modul("x", 1, { voraussetzung_course_id: "weg" })], [], new Set(), {});
  assert.equal(ohne.get("x").gesperrt, false);
  const leer = modulSperren([modul("v", 1), modul("x", 2, { voraussetzung_course_id: "v" })], [], new Set(), {});
  assert.equal(leer.get("x").gesperrt, false);
  const selbst = modulSperren([modul("x", 1, { voraussetzung_course_id: "x" })], [lektion("x1", "x", 1)], new Set(), {});
  assert.equal(selbst.get("x").gesperrt, false);
});
test("Lektion ab Tag X nach Start", () => {
  const l = lektion("l", "m", 1, { freigeschaltet_ab: 7 });
  const heute = new Date("2026-10-28T12:00:00Z");
  assert.equal(tageSeit("2026-10-21", heute), 7);
  assert.equal(lektionSperre(l, undefined, "2026-10-21", heute).gesperrt, false);
  const s = lektionSperre(l, undefined, "2026-10-25", heute);
  assert.equal(s.gesperrt, true);
  assert.equal(s.grund, "zeit");
  assert.equal(s.hinweis, "In 4 Tagen verfügbar");
  assert.equal(lektionSperre(l, undefined, "2026-10-27", new Date("2026-11-02T08:00:00Z")).hinweis, "Ab morgen verfügbar");
  assert.equal(lektionSperre(l, undefined, null, heute).gesperrt, false, "ohne Startdatum nicht sperren");
  assert.equal(lektionSperre(lektion("o", "m", 1), undefined, "2026-10-28", heute).gesperrt, false);
});
test("Modul-Sperre gilt für alle Lektionen", () => {
  const sperre = { gesperrt: true, grund: "firma", hinweis: "x" };
  assert.equal(lektionSperre(lektion("l", "m", 1), sperre, null, new Date()).grund, "firma");
});

console.log("Video-URL → Einbettung");
test("YouTube (watch, youtu.be, shorts, embed) inkl. Startzeit", () => {
  const e = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0";
  assert.equal(videoEinbettung("https://www.youtube.com/watch?v=dQw4w9WgXcQ").src, e);
  assert.equal(videoEinbettung("https://youtu.be/dQw4w9WgXcQ?si=abc").src, e);
  assert.equal(videoEinbettung("https://youtube.com/shorts/dQw4w9WgXcQ").src, e);
  assert.equal(videoEinbettung("https://www.youtube.com/embed/dQw4w9WgXcQ").src, e);
  assert.equal(videoEinbettung("https://www.youtube.com/watch?feature=x&v=dQw4w9WgXcQ").src, e);
  assert.equal(videoEinbettung("https://youtu.be/dQw4w9WgXcQ", 75).src, `${e}&start=75&autoplay=1`);
  assert.equal(videoEinbettung("https://youtu.be/dQw4w9WgXcQ").anbieter, "youtube");
});
test("Vimeo (auch privat mit Hash)", () => {
  assert.equal(videoEinbettung("https://vimeo.com/123456789").src, "https://player.vimeo.com/video/123456789");
  assert.equal(videoEinbettung("https://vimeo.com/123456789/abcdef12").src, "https://player.vimeo.com/video/123456789?h=abcdef12");
  assert.equal(videoEinbettung("https://player.vimeo.com/video/123456789").src, "https://player.vimeo.com/video/123456789");
  assert.equal(videoEinbettung("https://vimeo.com/123456789", 30).src, "https://player.vimeo.com/video/123456789#t=30s");
});
test("Loom", () => {
  assert.equal(
    videoEinbettung("https://www.loom.com/share/0123456789abcdef0123456789abcdef").src,
    "https://www.loom.com/embed/0123456789abcdef0123456789abcdef",
  );
});
test("MP4-Datei → <video>", () => {
  const v = videoEinbettung("https://cdn.example.de/videos/start.mp4?token=1");
  assert.equal(v.art, "datei");
  assert.equal(v.src, "https://cdn.example.de/videos/start.mp4?token=1");
  assert.equal(videoEinbettung("https://x.de/a.webm", 10).src, "https://x.de/a.webm#t=10");
});
test("Unbekannt / unsicher → null", () => {
  assert.equal(videoEinbettung(null), null);
  assert.equal(videoEinbettung(""), null);
  assert.equal(videoEinbettung("https://example.org/seite"), null);
  assert.equal(videoEinbettung("http://youtu.be/dQw4w9WgXcQ"), null, "nur https");
  assert.equal(videoEinbettung("javascript:alert(1)//youtu.be/dQw4w9WgXcQ"), null);
  assert.equal(videoEinbettung("https://evil.de/?u=youtu.be/dQw4w9WgXcQ"), null);
});
test("Zeitmarken lesen und schreiben", () => {
  const z = parseZeitmarken("1:15 Einwände\n0:00 Einstieg\nquatsch\n1:02:05 Abschluss\n  ");
  assert.deepEqual(z, [
    { sekunden: 0, titel: "Einstieg" },
    { sekunden: 75, titel: "Einwände" },
    { sekunden: 3725, titel: "Abschluss" },
  ]);
  assert.equal(zeitmarkenText(z), "0:00 Einstieg\n1:15 Einwände\n1:02:05 Abschluss");
});

console.log("HTML-Filter & Markdown");
test("Skripte, Event-Handler, Styles und iframes fallen weg", () => {
  assert.equal(bereinigeHtml('<p onclick="x()">Hallo<script>alert(1)</script></p>'), "<p>Hallo</p>");
  assert.equal(bereinigeHtml('<img src=x onerror="alert(1)">Text'), "Text");
  assert.equal(bereinigeHtml('<iframe src="https://evil"></iframe><style>body{}</style>ok'), "ok");
  assert.equal(bereinigeHtml("<svg><script>alert(1)</script></svg>ok"), "ok");
  assert.equal(bereinigeHtml('<p style="color:red">x</p>'), "<p>x</p>");
});
test("Links: nur sichere Ziele, immer neues Fenster", () => {
  assert.equal(
    bereinigeHtml('<a href="https://hoffmann.de/x?a=1&b=2">Link</a>'),
    '<a href="https://hoffmann.de/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Link</a>',
  );
  assert.equal(bereinigeHtml('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(bereinigeHtml('<a href="java&#x09;script:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(bereinigeHtml("<a href='data:text/html,<script>'>x</a>"), "<a>x</a>");
  assert.equal(bereinigeHtml('<a href="//evil.de">x</a>'), "<a>x</a>");
  assert.match(bereinigeHtml('<a href="https://x.de" onmouseover="alert(1)">x</a>'), /^<a href="https:\/\/x\.de" target/);
});
test("Text wird maskiert, offene Tags geschlossen", () => {
  assert.equal(bereinigeHtml("1 < 2 & 3 > 2"), "1 &lt; 2 &amp; 3 &gt; 2");
  assert.equal(bereinigeHtml("<ul><li>a<li>b</ul>"), "<ul><li>a<li>b</li></li></ul>");
  assert.equal(bereinigeHtml("<strong>offen"), "<strong>offen</strong>");
  assert.equal(bereinigeHtml("</p>zu"), "zu");
});
test("Markdown: Überschriften, Listen, fett, kursiv, Link, Zitat", () => {
  const html = markdownZuHtml(
    "## Leitfaden\n\nErst **zuhören**, dann *fragen*.\nZweite Zeile\n\n- Punkt A\n- Punkt B\n\n1. Eins\n2. Zwei\n\n> Merksatz\n\n[Mehr](https://hoffmann.de)\n\n---",
  );
  assert.equal(
    html,
    [
      "<h2>Leitfaden</h2>",
      "<p>Erst <strong>zuhören</strong>, dann <em>fragen</em>.<br>Zweite Zeile</p>",
      "<ul><li>Punkt A</li><li>Punkt B</li></ul>",
      "<ol><li>Eins</li><li>Zwei</li></ol>",
      "<blockquote>Merksatz</blockquote>",
      '<p><a href="https://hoffmann.de" target="_blank" rel="noopener noreferrer">Mehr</a></p>',
      "<hr>",
    ].join("\n"),
  );
});
test("Markdown: rohes HTML und böse Links werden entschärft", () => {
  assert.equal(markdownZuHtml("<script>alert(1)</script> Hallo"), "<p>&lt;script&gt;alert(1)&lt;/script&gt; Hallo</p>");
  assert.equal(markdownZuHtml("[klick](javascript:alert(1))"), "<p>klick)</p>");
  assert.equal(markdownZuHtml('[x](https://a.de/"onmouseover="alert(1))'), '<p><a href="https://a.de/%22onmouseover=%22alert(1" target="_blank" rel="noopener noreferrer">x</a>)</p>');
  assert.equal(markdownZuHtml('<img src=x onerror=alert(1)>'), "<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  assert.equal(markdownZuHtml("### Titel\nText"), "<h3>Titel</h3>\n<p>Text</p>");
  assert.equal(markdownZuHtml(""), "");
});
test("Markdown: Unterstriche in Wörtern bleiben", () => {
  assert.equal(markdownZuHtml("datei_name_neu und _kursiv_"), "<p>datei_name_neu und <em>kursiv</em></p>");
});

console.log("Dateien");
test("Sichere Dateinamen und Speicherpfade", () => {
  assert.equal(sichererDateiname("Gesprächsleitfaden Übersicht (final).PDF"), "gespraechsleitfaden-uebersicht-final-.pdf");
  assert.equal(sichererDateiname("../../etc/passwd"), "etc-passwd");
  assert.equal(sichererDateiname("###"), "datei");
  assert.equal(istSpeicherPfad("lektionen/abc-123/1700000000-leitfaden.pdf"), true);
  assert.equal(istSpeicherPfad("https://x.de/a.pdf"), false);
  assert.equal(istSpeicherPfad("lektionen/../x.pdf"), false);
  assert.equal(istSpeicherPfad("ohne-ordner.pdf"), false);
});

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`);
process.exit(fehler ? 1 : 0);
