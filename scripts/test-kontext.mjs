// Prüft die reine Zugriffslogik der Cloud (öffentliche Pfade, Rollen-Routing, Impersonation).
// Aufruf: node scripts/test-kontext.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import {
  ANSICHT_COOKIE,
  bereichFuer,
  darfZugangVerwalten,
  entscheideZugriff,
  istOeffentlicherPfad,
  sichererZielpfad,
  startseiteFuer,
  wirksameFirma,
} from "../src/lib/zugriff.ts";

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

const FIRMA = "3f2b8c1e-7a4d-4e5f-9b6a-1c2d3e4f5a6b";
const admin = { rolle: "admin", aktiv: true };
const sales = { rolle: "sales", aktiv: true };
const fulfillment = { rolle: "fulfillment", aktiv: true };
const owner = { rolle: "client_owner", aktiv: true };
const member = { rolle: "client_member", aktiv: true };
const z = (pfad, profil, extra = {}) =>
  entscheideZugriff({ pfad, angemeldet: !!profil, profil, ansichtGesetzt: false, ...extra });

console.log("Öffentliche Pfade");
test("Webhooks, Crons, Auth-API, Automation", () => {
  for (const p of [
    "/api/webhooks/close",
    "/api/webhooks/whatsapp",
    "/api/cron/sync-close",
    "/api/auth/callback",
    "/api/automation/activate-company",
  ])
    assert.equal(istOeffentlicherPfad(p), true, p);
});
test("Token-Links /b /j /n /t (+ics)", () => {
  for (const p of ["/b/abc", "/j/abc", "/n/abc", "/t/abc", "/t/abc/ics"]) assert.equal(istOeffentlicherPfad(p), true, p);
});
test("Statische Dateien", () => {
  for (const p of ["/reports/handwerksreport-2027.pdf", "/logo.png", "/icon.svg", "/favicon.ico", "/_next/static/x.js"])
    assert.equal(istOeffentlicherPfad(p), true, p);
});
test("Login + Passwort setzen öffentlich", () => {
  assert.equal(istOeffentlicherPfad("/login"), true);
  assert.equal(istOeffentlicherPfad("/passwort-setzen"), true);
});
test("Geschützt: Seiten, Formulare, Debug-API", () => {
  for (const p of ["/", "/sales", "/sales/whatsapp", "/kunden", "/dashboard", "/leads/1", "/forms/after-close", "/api/debug/auth", "/kein-zugang"])
    assert.equal(istOeffentlicherPfad(p), false, p);
});
test("Präfix nur ganze Segmente (/tabc ≠ /t/)", () => {
  assert.equal(istOeffentlicherPfad("/tabc"), false);
  assert.equal(istOeffentlicherPfad("/loginx"), false);
  assert.equal(bereichFuer("/salesx"), "allgemein");
});

console.log("Nicht angemeldet");
test("Seite → /login?next=…", () => {
  assert.deepEqual(entscheideZugriff({ pfad: "/leads", vollerPfad: "/leads?x=1", angemeldet: false, profil: null, ansichtGesetzt: false }), {
    typ: "umleiten",
    ziel: "/login?next=%2Fleads%3Fx%3D1",
  });
});
test("/ → /login ohne next", () => assert.deepEqual(z("/", null), { typ: "umleiten", ziel: "/login" }));
test("API → 401", () => assert.deepEqual(z("/api/debug/auth", null), { typ: "nicht_angemeldet" }));
test("Webhook bleibt offen", () => assert.deepEqual(z("/api/webhooks/lead", null), { typ: "weiter" }));
test("Formular braucht Login", () => assert.equal(z("/forms/after-close", null).typ, "umleiten"));

console.log("Gesperrt / ohne Profil");
test("inaktiv → abmelden", () =>
  assert.deepEqual(z("/sales", { rolle: "admin", aktiv: false }), { typ: "abmelden", ziel: "/login?fehler=gesperrt" }));
test("angemeldet ohne Profil → abmelden", () =>
  assert.equal(entscheideZugriff({ pfad: "/dashboard", angemeldet: true, profil: null, ansichtGesetzt: false }).typ, "abmelden"));

console.log("Rollen-Routing");
test("Startseiten", () => {
  assert.equal(startseiteFuer("admin"), "/sales");
  assert.equal(startseiteFuer("sales"), "/sales");
  assert.equal(startseiteFuer("fulfillment"), "/fulfillment");
  assert.equal(startseiteFuer("client_owner"), "/dashboard");
  assert.equal(startseiteFuer("client_member"), "/dashboard");
});
test("/ leitet je Rolle", () => {
  assert.deepEqual(z("/", fulfillment), { typ: "umleiten", ziel: "/fulfillment" });
  assert.deepEqual(z("/", member), { typ: "umleiten", ziel: "/dashboard" });
});
test("Login angemeldet → Startseite", () => assert.deepEqual(z("/login", owner), { typ: "umleiten", ziel: "/dashboard" }));
test("Kunde darf keine Team-Seiten", () => {
  for (const p of ["/sales", "/sales/funnels", "/kunden", "/team", "/sops/1", "/fulfillment"])
    assert.deepEqual(z(p, owner), { typ: "umleiten", ziel: "/dashboard" }, p);
});
test("Kunde darf keine Debug-API", () => assert.deepEqual(z("/api/debug/calendly", member), { typ: "verboten" }));
test("Kunde darf Kundenseiten + Formulare", () => {
  for (const p of ["/dashboard", "/leads", "/leads/abc", "/akademie", "/downloads", "/status", "/forms/after-close"])
    assert.deepEqual(z(p, member), { typ: "weiter" }, p);
});
test("Team darf Team-Seiten", () => {
  assert.deepEqual(z("/sales", sales), { typ: "weiter" });
  assert.deepEqual(z("/kunden", fulfillment), { typ: "weiter" });
});
test("/team nur Admin", () => {
  assert.deepEqual(z("/team", admin), { typ: "weiter" });
  assert.deepEqual(z("/team", sales), { typ: "umleiten", ziel: "/sales" });
});
test("Team auf Kundenseite ohne Ansicht → /kunden", () =>
  assert.deepEqual(z("/dashboard", admin), { typ: "umleiten", ziel: "/kunden?hinweis=ansicht" }));
test("Team auf Kundenseite mit Ansicht → weiter", () =>
  assert.deepEqual(z("/leads", sales, { ansichtGesetzt: true }), { typ: "weiter" }));

console.log("Impersonation");
test("Cookie-Name", () => assert.equal(ANSICHT_COOKIE, "hs_ansicht_kunde"));
test("Team + gültiges Cookie + Firma existiert", () =>
  assert.deepEqual(wirksameFirma({ rolle: "admin", eigeneCompanyId: null, cookieWert: FIRMA, firmaExistiert: true }), {
    companyId: FIRMA,
    impersoniert: true,
  }));
test("Team + Firma existiert nicht", () =>
  assert.deepEqual(wirksameFirma({ rolle: "sales", eigeneCompanyId: null, cookieWert: FIRMA, firmaExistiert: false }), {
    companyId: null,
    impersoniert: false,
  }));
test("Team + kaputtes Cookie", () =>
  assert.equal(wirksameFirma({ rolle: "fulfillment", eigeneCompanyId: null, cookieWert: "x'; drop", firmaExistiert: true }).companyId, null));
test("Kunde: Cookie wird ignoriert, eigene Firma zählt", () =>
  assert.deepEqual(wirksameFirma({ rolle: "client_owner", eigeneCompanyId: "eigene", cookieWert: FIRMA, firmaExistiert: true }), {
    companyId: "eigene",
    impersoniert: false,
  }));
test("Kunde ohne Firma → null", () =>
  assert.equal(wirksameFirma({ rolle: "client_member", eigeneCompanyId: null, cookieWert: null, firmaExistiert: false }).companyId, null));

console.log("Rücksprungziel + Zugänge");
test("next nur relativ", () => {
  assert.equal(sichererZielpfad("/leads?x=1"), "/leads?x=1");
  assert.equal(sichererZielpfad("https://boese.de"), "/");
  assert.equal(sichererZielpfad("//boese.de"), "/");
  assert.equal(sichererZielpfad("/\\boese.de"), "/");
  assert.equal(sichererZielpfad("/login"), "/");
  assert.equal(sichererZielpfad(undefined), "/");
});
test("Wer darf welche Zugänge verwalten", () => {
  assert.equal(darfZugangVerwalten("admin", "admin"), true);
  assert.equal(darfZugangVerwalten("admin", "client_owner"), true);
  assert.equal(darfZugangVerwalten("sales", "client_member"), true);
  assert.equal(darfZugangVerwalten("fulfillment", "client_owner"), true);
  assert.equal(darfZugangVerwalten("sales", "admin"), false);
  assert.equal(darfZugangVerwalten("fulfillment", "sales"), false);
  assert.equal(darfZugangVerwalten("client_owner", "client_member"), false);
});

console.log(`\n${ok} ok, ${fehler} fehlgeschlagen`);
if (fehler) process.exit(1);
