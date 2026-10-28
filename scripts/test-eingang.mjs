// Prüft die reine Logik des Lead-Eingangs (Parser Perspective/Google/Webhook/Meta, E.164, Dedupe, Signatur).
// Aufruf: node scripts/test-eingang.mjs   (Node ≥ 22.18 / 23.6 für TypeScript-Imports)

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  benachrichtigungText,
  dedupeSchluessel,
  flach,
  gleichSicher,
  istToken,
  leadZeile,
  leseBody,
  leseGoogle,
  leseMapping,
  leseMetaAenderungen,
  leseMetaLead,
  lesePerspective,
  leseWebhook,
  metaConfig,
  metaSignaturGueltig,
  metaZuordnung,
  neuerToken,
  perPfad,
  pruefeLead,
  telefonE164,
  teileName,
  testBody,
} from "../src/lib/eingang/logik.ts";

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

console.log("Telefon E.164");
test("deutsche Formate", () => {
  assert.equal(telefonE164("0151 2345 6789"), "+4915123456789");
  assert.equal(telefonE164("+49 (0) 30 123456"), "+4930123456");
  assert.equal(telefonE164("0049 171 1234567"), "+491711234567");
  assert.equal(telefonE164("+49 171/123-4567"), "+491711234567");
  assert.equal(telefonE164("4915123456789"), "+4915123456789");
  assert.equal(telefonE164("15123456789"), "+4915123456789");
  assert.equal(telefonE164("030 1234567"), "+49301234567");
});
test("Ausland und Unbrauchbares", () => {
  assert.equal(telefonE164("+43 664 1234567"), "+436641234567");
  assert.equal(telefonE164("0041 79 123 45 67"), "+41791234567");
  assert.equal(telefonE164("123"), null);
  assert.equal(telefonE164("keine Angabe"), null);
  assert.equal(telefonE164(""), null);
  assert.equal(telefonE164(null), null);
  assert.equal(telefonE164("+0049"), null);
});

console.log("Perspective");
// Echtes Beispiel (Struktur aus Perspective: profile.<feld> = { value, title })
const perspective = {
  id: "6720c4f1a2b3c4d5e6f70809",
  funnelName: "Badsanierung Berlin",
  profile: {
    first_name: { value: "Markus", title: "Vorname" },
    last_name: { value: "Müller", title: "Nachname" },
    email: { value: "Markus@Mueller-Bau.de ", title: "E-Mail" },
    phone: { value: "0151 2345 6789", title: "Telefonnummer" },
    company_name: { value: "Müller Bau GmbH", title: "Firmenname" },
    q_bad: { value: "Komplettsanierung", title: "Was möchten Sie sanieren?" },
    q_wann: { value: ["In 1–3 Monaten"], title: "Wann soll es losgehen?" },
    plz: { value: "10115", title: "Postleitzahl" },
    utm_source: { value: "facebook", title: "UTM Source" },
    utm_campaign: { value: "bad-herbst", title: "UTM Campaign" },
    utm_medium: { value: "UTM Medium", title: "UTM Medium" },
  },
  meta: { utm_content: "video-1", fbclid: "IwAR123" },
};
test("Kontakt, Antworten mit Titel, UTM", () => {
  const l = lesePerspective(perspective);
  assert.equal(l.externalId, "6720c4f1a2b3c4d5e6f70809");
  assert.equal(l.vorname, "Markus");
  assert.equal(l.nachname, "Müller");
  assert.equal(l.email, "markus@mueller-bau.de");
  assert.equal(l.telefon, "+4915123456789");
  assert.equal(l.plz, "10115");
  assert.equal(l.formular, "Badsanierung Berlin");
  assert.equal(l.kampagne, "bad-herbst");
  assert.deepEqual(l.antworten, [
    { frage: "Firmenname", antwort: "Müller Bau GmbH" },
    { frage: "Was möchten Sie sanieren?", antwort: "Komplettsanierung" },
    { frage: "Wann soll es losgehen?", antwort: "In 1–3 Monaten" },
  ]);
  assert.deepEqual(l.utm, { source: "facebook", campaign: "bad-herbst", content: "video-1", fbclid: "IwAR123" });
  assert.equal(l.test, false);
  assert.equal(pruefeLead(l), null);
});
test("values + titles statt profile", () => {
  const l = lesePerspective({
    id: 42,
    funnelName: "X",
    values: { name: "Anna Schmidt", telefonnummer: "0171 1234567", frage1: "Dach" },
    titles: { name: "Ihr Name", telefonnummer: "Telefon", frage1: "Worum geht es?" },
  });
  assert.equal(l.externalId, "42");
  assert.equal(l.vorname, "Anna");
  assert.equal(l.nachname, "Schmidt");
  assert.equal(l.telefon, "+491711234567");
  assert.deepEqual(l.antworten, [{ frage: "Worum geht es?", antwort: "Dach" }]);
});
test("Beschriftung als Kontaktfeld erkennen", () => {
  const l = lesePerspective({ id: "a", profile: { f1: { value: "anna@x.de", title: "E-Mail-Adresse" }, f2: { value: "Anna", title: "Vorname" } } });
  assert.equal(l.email, "anna@x.de");
  assert.equal(l.vorname, "Anna");
  assert.equal(l.antworten.length, 0);
});

console.log("Google Ads");
// Struktur laut Google-Ads-Doku „Lead form webhook“
const google = {
  lead_id: "TeSter-123-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdefghijklmnopqrstuvwxyz-0123456789-AaBbCcDdEeFfGgHhIiJjKkLl",
  user_column_data: [
    { column_name: "Full Name", string_value: "FirstName LastName", column_id: "FULL_NAME" },
    { column_name: "User Phone", string_value: "+16505550123", column_id: "PHONE_NUMBER" },
    { column_name: "User Email", string_value: "test@example.com", column_id: "EMAIL" },
    { column_name: "Postal Code", string_value: "94043", column_id: "POSTAL_CODE" },
    { column_name: "Welche Leistung?", string_value: "Dachsanierung", column_id: "welche_leistung?" },
  ],
  api_version: "1.0",
  form_id: 40000000000,
  campaign_id: 50000000000,
  google_key: "geheimerSchluessel",
  is_test: true,
  gcl_id: "gclid-test",
  adgroup_id: 20000000000,
  creative_id: 30000000000,
};
test("Felder, IDs, Testmarkierung", () => {
  const { lead: l, googleKey } = leseGoogle(google);
  assert.equal(googleKey, "geheimerSchluessel");
  assert.equal(l.externalId, google.lead_id);
  assert.equal(l.vorname, "FirstName");
  assert.equal(l.nachname, "LastName");
  assert.equal(l.telefon, "+16505550123");
  assert.equal(l.email, "test@example.com");
  assert.equal(l.plz, "94043");
  assert.equal(l.kampagneId, "50000000000");
  assert.equal(l.anzeigengruppe, "20000000000");
  assert.equal(l.formular, "40000000000");
  assert.equal(l.utm.gclid, "gclid-test");
  assert.equal(l.test, true);
  assert.deepEqual(l.antworten, [{ frage: "Welche Leistung?", antwort: "Dachsanierung" }]);
});
test("Schlüssel zeitkonstant prüfen", () => {
  assert.equal(gleichSicher("abc", "abc"), true);
  assert.equal(gleichSicher("abc", "abd"), false);
  assert.equal(gleichSicher("abc", "abcd"), false);
  assert.equal(gleichSicher(null, "abc"), false);
  assert.equal(gleichSicher("", ""), false);
});
test("Testlead wird markiert gespeichert", () => {
  const { lead } = leseGoogle(google);
  const z = leadZeile(lead, { id: "q1", company_id: "c1", art: "google", name: "Google" }, "google:x", google);
  assert.equal(z.quelle, "google_ads");
  assert.equal(z.utm.test, "ja");
  assert.equal(z.antworten[0].frage, "Hinweis");
  assert.equal(z.status, "neu");
  assert.equal(z.company_id, "c1");
  assert.equal(z.external_id, "google:x");
});

console.log("Webhook allgemein");
test("flache Felder (JSON)", () => {
  const l = leseWebhook({ name: "Peter Lustig", telefon: "0170 1234567", email: "P@L.de", plz: "50667", ort: "Köln", nachricht: "Bitte Rückruf", budget: "5000", utm_source: "google", form_id: "kontakt" });
  assert.equal(l.vorname, "Peter");
  assert.equal(l.nachname, "Lustig");
  assert.equal(l.telefon, "+491701234567");
  assert.equal(l.email, "p@l.de");
  assert.equal(l.plz, "50667");
  assert.equal(l.ort, "Köln");
  assert.equal(l.anliegen, "Bitte Rückruf");
  assert.equal(l.formular, "kontakt");
  assert.deepEqual(l.utm, { source: "google" });
  assert.deepEqual(l.antworten, [{ frage: "budget", antwort: "5000" }]);
});
test("form-urlencoded", () => {
  const body = leseBody("vorname=Eva&nachname=Klein&phone=%2B49%20160%201234567&wunsch=Fenster");
  const l = leseWebhook(body);
  assert.equal(l.vorname, "Eva");
  assert.equal(l.nachname, "Klein");
  assert.equal(l.telefon, "+491601234567");
  assert.deepEqual(l.antworten, [{ frage: "wunsch", antwort: "Fenster" }]);
});
test("Mapping mit Punkt-Pfaden + verschachtelte Reste", () => {
  const body = { data: { kontakt: { handy: "0151 11111111", voll: "Lisa Berg" }, extra: { dach: "Flachdach" } }, submission: { uid: "s-9" } };
  const mapping = leseMapping({ telefon: "data.kontakt.handy", name: "data.kontakt.voll", external_id: "submission.uid", boese: "x", ort: "a..b" });
  assert.deepEqual(mapping, { name: "data.kontakt.voll", telefon: "data.kontakt.handy", external_id: "submission.uid" });
  const l = leseWebhook(body, mapping);
  assert.equal(l.telefon, "+4915111111111");
  assert.equal(l.vorname, "Lisa");
  assert.equal(l.externalId, "s-9");
  assert.deepEqual(l.antworten, [{ frage: "data.extra.dach", antwort: "Flachdach" }]);
});
test("Frage/Antwort-Listen", () => {
  const l = leseWebhook({ email: "a@b.de", answers: [{ question: "Fläche?", answer: "80 m²" }] });
  assert.deepEqual(l.antworten, [{ frage: "Fläche?", antwort: "80 m²" }]);
});
test("Pfade ohne Prototyp-Zugriff", () => {
  assert.equal(perPfad({ a: { b: 1 } }, "a.b"), 1);
  assert.equal(perPfad({}, "__proto__.x"), undefined);
  assert.equal(perPfad({ a: [{ b: "x" }] }, "a.0.b"), "x");
  assert.deepEqual(flach({ a: { b: "1" } }), [["a.b", "1"]]);
});
test("Body unlesbar", () => {
  assert.equal(leseBody(""), null);
  assert.equal(leseBody("{kaputt"), null);
  assert.equal(leseBody("[1,2]"), null);
});

console.log("Meta");
const metaWebhook = {
  object: "page",
  entry: [
    {
      id: "102345678901234",
      time: 1730000000,
      changes: [
        { field: "leadgen", value: { ad_id: "1", form_id: "555000111", leadgen_id: "987654321012345", created_time: 1730000000, page_id: "102345678901234", adgroup_id: "2" } },
        { field: "feed", value: { item: "post" } },
      ],
    },
  ],
};
test("Änderungen lesen", () => {
  const a = leseMetaAenderungen(metaWebhook);
  assert.equal(a.length, 1);
  assert.deepEqual(a[0], { leadgenId: "987654321012345", pageId: "102345678901234", formId: "555000111", adId: "1", adgroupId: "2", campaignId: null });
  assert.deepEqual(leseMetaAenderungen({ entry: "x" }), []);
});
test("Graph-Antwort lesen", () => {
  const [a] = leseMetaAenderungen(metaWebhook);
  const l = leseMetaLead(
    {
      id: "987654321012345",
      created_time: "2026-10-28T10:00:00+0000",
      field_data: [
        { name: "full_name", values: ["Jonas Weber"] },
        { name: "phone_number", values: ["+4915209876543"] },
        { name: "email", values: ["jonas@web.de"] },
        { name: "zip_code", values: ["80331"] },
        { name: "wann_soll_es_losgehen?", values: ["sofort"] },
      ],
      ad_name: "Video Bad",
      adset_name: "München 30 km",
      campaign_name: "Bad Herbst",
      campaign_id: "120000",
      form_id: "555000111",
    },
    a,
  );
  assert.equal(l.externalId, "987654321012345");
  assert.equal(l.vorname, "Jonas");
  assert.equal(l.nachname, "Weber");
  assert.equal(l.telefon, "+4915209876543");
  assert.equal(l.plz, "80331");
  assert.equal(l.kampagne, "Bad Herbst");
  assert.equal(l.kampagneId, "120000");
  assert.equal(l.anzeigengruppe, "München 30 km");
  assert.equal(l.formular, "555000111");
  assert.equal(l.utm.content, "Video Bad");
  assert.deepEqual(l.antworten, [{ frage: "Wann soll es losgehen?", antwort: "sofort" }]);
});
test("Zuordnung Seite/Formular", () => {
  const q = [
    { id: "alle", company_id: "c1", aktiv: true, config: { page_id: "111", form_ids: [] } },
    { id: "form", company_id: "c2", aktiv: true, config: { page_id: "111", form_ids: ["999"] } },
    { id: "aus", company_id: "c3", aktiv: false, config: { page_id: "222", form_ids: [] } },
  ];
  assert.equal(metaZuordnung(q, "111", "999")?.id, "form");
  assert.equal(metaZuordnung(q, "111", "123")?.id, "alle");
  assert.equal(metaZuordnung(q, "222", null), null);
  assert.equal(metaZuordnung(q, null, null), null);
  assert.equal(metaZuordnung(q, "333", null), null);
});
test("Token-Variable nur mit Präfix", () => {
  assert.equal(metaConfig({ page_id: "111", token_env: "SUPABASE_SERVICE_ROLE_KEY" }).tokenEnv, null);
  assert.equal(metaConfig({ page_id: "111", token_env: "META_PAGE_TOKEN_MUELLER" }).tokenEnv, "META_PAGE_TOKEN_MUELLER");
  assert.deepEqual(metaConfig({ page_id: "111", form_ids: "1234, 5678;x" }).formIds, ["1234", "5678"]);
});
test("Signatur X-Hub-Signature-256", () => {
  const roh = JSON.stringify(metaWebhook);
  const sig = "sha256=" + createHmac("sha256", "appgeheim").update(roh).digest("hex");
  assert.equal(metaSignaturGueltig(roh, sig, "appgeheim"), true);
  assert.equal(metaSignaturGueltig(roh + " ", sig, "appgeheim"), false);
  assert.equal(metaSignaturGueltig(roh, sig, "anders"), false);
  assert.equal(metaSignaturGueltig(roh, "sha1=abc", "appgeheim"), false);
  assert.equal(metaSignaturGueltig(roh, "sha256=zz", "appgeheim"), false);
  assert.equal(metaSignaturGueltig(roh, null, "appgeheim"), false);
  assert.equal(metaSignaturGueltig(roh, sig, ""), false);
});

console.log("Prüfen, Dedupe, Token");
test("ungültige Leads", () => {
  assert.match(pruefeLead(leseWebhook({ budget: "5000" })), /Weder Name/);
  assert.equal(pruefeLead(leseWebhook({ telefon: "0151 2222222" })), null);
  assert.equal(pruefeLead(leseWebhook({ name: "Nur Name" })), null);
});
test("Dedupe-Schlüssel", () => {
  const tag = new Date("2026-10-28T10:00:00+01:00");
  assert.equal(dedupeSchluessel("perspective", { externalId: "abc", email: null, telefon: null }, tag), "perspective:abc");
  const a = dedupeSchluessel("webhook", { externalId: null, email: "A@b.de", telefon: "0151 2345 6789" }, tag);
  const b = dedupeSchluessel("webhook", { externalId: null, email: "a@b.de", telefon: "+4915123456789" }, new Date("2026-10-28T22:59:00+01:00"));
  const c = dedupeSchluessel("webhook", { externalId: null, email: "a@b.de", telefon: "+4915123456789" }, new Date("2026-10-29T00:01:00+01:00"));
  assert.match(a, /^h:[0-9a-f]{40}$/);
  assert.equal(a, b, "gleicher Kontakt, gleicher Tag → gleich");
  assert.notEqual(a, c, "neuer Tag → neuer Lead");
});
test("Token", () => {
  const t = neuerToken();
  assert.ok(t.length >= 32);
  assert.ok(istToken(t));
  assert.notEqual(t, neuerToken());
  assert.equal(istToken("kurz"), false);
  assert.equal(istToken("a/b".repeat(20)), false);
});
test("Name teilen, Benachrichtigung", () => {
  assert.deepEqual(teileName("Hans Peter Maier"), { vorname: "Hans", nachname: "Peter Maier" });
  assert.deepEqual(teileName(""), { vorname: "", nachname: "" });
  const b = benachrichtigungText(lesePerspective(perspective));
  assert.equal(b.titel, "Neue Anfrage: Markus Müller");
  assert.match(b.text, /10115/);
});
test("Testlead-Bodies laufen durch die Parser", () => {
  const jetzt = new Date();
  for (const l of [
    lesePerspective(testBody("perspective", jetzt)),
    leseGoogle(testBody("google", jetzt)).lead,
    leseWebhook(testBody("webhook", jetzt)),
    leseMetaLead(testBody("meta", jetzt), { leadgenId: "1", pageId: null, formId: null, adId: null, adgroupId: null, campaignId: null }),
  ]) {
    assert.equal(pruefeLead(l), null);
    assert.ok(l.telefon?.startsWith("+49"));
  }
});

console.log(`\n${ok} ok, ${fehler} fehlgeschlagen`);
if (fehler) process.exit(1);
