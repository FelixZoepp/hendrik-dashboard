/**
 * Lead-Eingang je Kunde (reine Logik, nur node:crypto — das Prüfskript scripts/test-eingang.mjs lädt die Datei direkt).
 *
 * Jeder Handwerksbetrieb hat eigene Eingänge (Tabelle lead_quellen). Pro Art gibt es einen Parser,
 * der den Webhook-Body in einen EingangLead übersetzt: Kontaktdaten in die Lead-Spalten,
 * alles Übrige als antworten [{frage, antwort}], UTM-Werte in utm.
 *
 *   perspective → { id, funnelName, profile: { feld: { value, title } }, values?, titles?, meta? }
 *   google      → Google-Ads-Lead-Formular-Webhook { lead_id, user_column_data[], campaign_id, adgroup_id, form_id, google_key, is_test }
 *   webhook     → beliebiges JSON / form-urlencoded (flache Felder, optional config.mapping mit Punkt-Pfaden)
 *   meta        → Graph-API-Antwort zu einer leadgen_id ({ field_data: [{ name, values }], ad_name, … })
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type QuellenArt = "perspective" | "meta" | "google" | "webhook";
export const QUELLEN_ARTEN: readonly QuellenArt[] = ["perspective", "meta", "google", "webhook"];

export type EingangStatus = "ok" | "duplikat" | "fehler" | "abgelehnt";

/** Wert der Spalte leads.quelle (enum lead_quelle) je Art */
export const LEAD_QUELLE_FUER: Record<QuellenArt, "perspective" | "meta" | "google_ads" | "webhook"> = {
  perspective: "perspective",
  meta: "meta",
  google: "google_ads",
  webhook: "webhook",
};

export interface Antwort {
  frage: string;
  antwort: string;
}

export interface EingangLead {
  /** ID des Lead-Systems (Perspective-Eintrag, Google lead_id, Meta leadgen_id …), sonst null */
  externalId: string | null;
  vorname: string;
  nachname: string;
  /** E.164, wenn erkennbar; sonst die Eingabe, wie sie kam */
  telefon: string | null;
  email: string | null;
  plz: string | null;
  ort: string | null;
  anliegen: string | null;
  /** Kampagnenname (leads.campaign) */
  kampagne: string | null;
  kampagneId: string | null;
  anzeigengruppe: string | null;
  formular: string | null;
  antworten: Antwort[];
  utm: Record<string, string>;
  /** Testlead (Google is_test, „Testlead senden“) */
  test: boolean;
}

export function leererLead(): EingangLead {
  return {
    externalId: null,
    vorname: "",
    nachname: "",
    telefon: null,
    email: null,
    plz: null,
    ort: null,
    anliegen: null,
    kampagne: null,
    kampagneId: null,
    anzeigengruppe: null,
    formular: null,
    antworten: [],
    utm: {},
    test: false,
  };
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const MAX_FRAGE = 300;
const MAX_ANTWORT = 2000;
const MAX_ANTWORTEN = 80;

/** Beliebigen Wert als Text (Arrays mit Komma, { value } aufgelöst) */
export function wert(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "ja" : "nein";
  if (Array.isArray(v)) return v.map(wert).filter(Boolean).join(", ") || null;
  if (v && typeof v === "object" && "value" in v) return wert((v as { value: unknown }).value);
  return null;
}

/** Schlüssel vergleichbar machen: „E-Mail-Adresse“ → „emailadresse“ */
export function norm(k: string): string {
  return k
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const istObjekt = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const kurz = (s: string | null, max = 200) => (s ? s.slice(0, max) : null);

/** Bekannte Kontaktfelder (normalisierte Schlüssel bzw. Beschriftungen) */
export const KONTAKT_FELDER = {
  vorname: ["firstname", "vorname", "first", "givenname"],
  nachname: ["lastname", "nachname", "last", "familyname", "surname", "zuname"],
  name: ["name", "fullname", "vollername", "ihrname", "vorundnachname", "kontaktname", "kundenname"],
  email: ["email", "mail", "emailadresse", "ihreemail", "ihreemailadresse", "workemail", "emailaddress"],
  telefon: [
    "phone",
    "telefon",
    "tel",
    "telefonnummer",
    "phonenumber",
    "handynummer",
    "mobilnummer",
    "mobil",
    "mobile",
    "handy",
    "whatsappnummer",
    "ihretelefonnummer",
    "rufnummer",
    "workphone",
  ],
  plz: ["plz", "postleitzahl", "zip", "zipcode", "postalcode", "postcode", "postcodezip"],
  ort: ["ort", "stadt", "city", "wohnort", "town"],
  anliegen: ["nachricht", "message", "anliegen", "anfrage", "kommentar", "comment", "comments", "bemerkung", "beschreibung", "ihrenachricht", "ihranliegen"],
} as const;

type KontaktFeld = keyof typeof KONTAKT_FELDER;

function kontaktFeld(schluessel: string | null | undefined): KontaktFeld | null {
  if (!schluessel) return null;
  const n = norm(schluessel);
  for (const [feld, namen] of Object.entries(KONTAKT_FELDER) as [KontaktFeld, readonly string[]][]) {
    if (namen.includes(n)) return feld;
  }
  return null;
}

function istUtm(schluessel: string): boolean {
  return /^utm/.test(norm(schluessel));
}

function utmName(schluessel: string): string {
  return norm(schluessel).replace(/^utm/, "") || "utm";
}

/** Perspective schickt manchmal die Beschriftung („UTM Source“) statt eines Werts */
function istUtmPlatzhalter(w: string): boolean {
  return /^utm[\s_]/i.test(w);
}

function telefonFeldWert(w: string): boolean {
  return /\d{5,}/.test(w.replace(/[\s()/.-]/g, ""));
}

/** Name in Vor- und Nachname teilen („Max Mustermann“ → Max / Mustermann) */
export function teileName(name: string | null | undefined): { vorname: string; nachname: string } {
  const teile = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return { vorname: "", nachname: "" };
  if (teile.length === 1) return { vorname: teile[0], nachname: "" };
  return { vorname: teile[0], nachname: teile.slice(1).join(" ") };
}

/**
 * Telefonnummer nach E.164 (Standard Deutschland). null, wenn unbrauchbar.
 * „0151 2345 6789“ → „+4915123456789“, „+49 (0) 30 123456“ → „+4930123456“, „0043 664 …“ → „+43664…“
 */
export function telefonE164(roh: string | null | undefined, land = "49"): string | null {
  if (!roh) return null;
  const sauber = String(roh).replace(/[^\d+]/g, "");
  if (!sauber) return null;
  let ziffern: string;
  if (sauber.startsWith("+")) ziffern = sauber.slice(1).replace(/\+/g, "");
  else if (sauber.startsWith("00")) ziffern = sauber.slice(2);
  else if (sauber.startsWith("0")) ziffern = `${land}${sauber.slice(1)}`;
  else if (land === "49" && sauber.startsWith("49") && sauber.length >= 11) ziffern = sauber;
  // Deutsche Mobilnummer ohne führende 0 („15123456789“)
  else if (land === "49" && /^1[5-7]\d{8,9}$/.test(sauber)) ziffern = `49${sauber}`;
  else return null;
  // „+49 (0) 151 …“ → Null nach der Ländervorwahl entfernen
  if (ziffern.startsWith("490")) ziffern = `49${ziffern.slice(3)}`;
  if (!/^[1-9]\d{7,14}$/.test(ziffern)) return null;
  return `+${ziffern}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailNormal(roh: string | null | undefined): string | null {
  const e = (roh ?? "").trim().toLowerCase();
  return EMAIL.test(e) ? e.slice(0, 200) : null;
}

/** Kontaktfeld setzen (erster Wert gewinnt), unbrauchbare Werte landen in antworten */
function setzeKontakt(lead: EingangLead, feld: KontaktFeld, w: string, frage: string): void {
  switch (feld) {
    case "vorname":
      if (!lead.vorname) lead.vorname = w.slice(0, 100);
      return;
    case "nachname":
      if (!lead.nachname) lead.nachname = w.slice(0, 100);
      return;
    case "name": {
      if (!lead.vorname && !lead.nachname) {
        const t = teileName(w);
        lead.vorname = t.vorname.slice(0, 100);
        lead.nachname = t.nachname.slice(0, 100);
      }
      return;
    }
    case "email": {
      const e = emailNormal(w);
      if (e && !lead.email) lead.email = e;
      else if (!e) fuegeAntwortHinzu(lead, frage, w);
      return;
    }
    case "telefon": {
      if (lead.telefon) {
        if (telefonE164(w) !== lead.telefon) fuegeAntwortHinzu(lead, frage, w);
        return;
      }
      lead.telefon = telefonE164(w) ?? w.slice(0, 40);
      return;
    }
    case "plz":
      if (!lead.plz) lead.plz = w.slice(0, 10);
      return;
    case "ort":
      if (!lead.ort) lead.ort = w.slice(0, 100);
      return;
    case "anliegen":
      lead.anliegen = lead.anliegen ? `${lead.anliegen}\n${w}`.slice(0, 4000) : w.slice(0, 4000);
      return;
  }
}

function fuegeAntwortHinzu(lead: EingangLead, frage: string, antwort: string): void {
  if (lead.antworten.length >= MAX_ANTWORTEN) return;
  const f = frage.trim() || "Angabe";
  lead.antworten.push({ frage: f.slice(0, MAX_FRAGE), antwort: antwort.slice(0, MAX_ANTWORT) });
}

function setzeUtm(lead: EingangLead, schluessel: string, w: string): void {
  if (istUtmPlatzhalter(w)) return;
  const k = utmName(schluessel);
  if (!lead.utm[k]) lead.utm[k] = w.slice(0, 200);
}

/** Ein Feld (Schlüssel + Beschriftung + Wert) einsortieren */
function feld(lead: EingangLead, schluessel: string, titel: string | null, w: string | null): void {
  if (!w) return;
  const frage = titel ?? schluessel;
  if (istUtm(schluessel)) {
    setzeUtm(lead, schluessel, w);
    return;
  }
  const k = kontaktFeld(schluessel) ?? kontaktFeld(titel);
  if (k === "telefon" && !telefonFeldWert(w)) {
    fuegeAntwortHinzu(lead, frage, w);
    return;
  }
  if (k) {
    setzeKontakt(lead, k, w, frage);
    return;
  }
  fuegeAntwortHinzu(lead, frage, w);
}

// ---------------------------------------------------------------------------
// Perspective
// ---------------------------------------------------------------------------

/** Felder, die Perspective im Profil mitschickt, aber keine Angabe des Leads sind */
const PERSPECTIVE_INTERN = new Set(["id", "createdat", "updatedat", "funnelid", "funnelname", "contactid", "workspaceid", "ip", "useragent"]);

export function lesePerspective(body: Record<string, unknown>): EingangLead {
  const lead = leererLead();
  const profile = istObjekt(body.profile) ? body.profile : null;
  const values = istObjekt(body.values) ? body.values : null;
  const titles = istObjekt(body.titles) ? body.titles : null;

  const gesehen = new Set<string>();
  const verarbeite = (k: string, v: unknown, titelExtra: unknown) => {
    const n = norm(k);
    if (gesehen.has(n) || PERSPECTIVE_INTERN.has(n)) return;
    gesehen.add(n);
    const titel = istObjekt(v) && "title" in v ? wert(v.title) : wert(titelExtra);
    feld(lead, k, titel, wert(v));
  };

  if (profile) for (const [k, v] of Object.entries(profile)) verarbeite(k, v, titles?.[k]);
  if (values) for (const [k, v] of Object.entries(values)) verarbeite(k, v, titles?.[k]);
  if (!profile && !values) {
    // Flacher Body (ältere Perspective-Webhooks / Tests)
    for (const [k, v] of Object.entries(body)) {
      if (["id", "funnelName", "funnel_name", "meta", "tracking", "query", "utm"].includes(k)) continue;
      if (istObjekt(v) && !("value" in v)) continue;
      verarbeite(k, v, null);
    }
  }

  // UTM aus meta/tracking/query/utm (auch eine Ebene tiefer, z. B. meta.utm.source)
  for (const q of [body.meta, body.tracking, body.query, body.utm]) sammleUtm(lead, q, "");

  lead.externalId = idText(body.id) ?? idText(body.submissionId) ?? idText(body.entryId);
  const funnel = wert(body.funnelName) ?? wert(body.funnel_name) ?? (istObjekt(body.funnel) ? wert(body.funnel.name) : null);
  lead.formular = kurz(funnel);
  lead.kampagne = kurz(lead.utm.campaign ?? funnel);
  return lead;
}

function sammleUtm(lead: EingangLead, q: unknown, praefix: string): void {
  if (!istObjekt(q)) return;
  for (const [k, v] of Object.entries(q)) {
    const schluessel = praefix ? `${praefix}${k}` : k;
    if (istObjekt(v) && !("value" in v)) {
      if (norm(k) === "utm") sammleUtm(lead, v, "utm_");
      continue;
    }
    const w = wert(v);
    if (w && istUtm(schluessel)) setzeUtm(lead, schluessel, w);
    else if (w && ["gclid", "fbclid", "wbraid", "gbraid"].includes(norm(k)) && !lead.utm[norm(k)]) lead.utm[norm(k)] = w.slice(0, 200);
  }
}

function idText(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

// ---------------------------------------------------------------------------
// Google Ads (Lead-Formular-Webhook)
// ---------------------------------------------------------------------------

/** column_id der Google-Lead-Formulare → Kontaktfeld */
const GOOGLE_SPALTEN: Record<string, KontaktFeld> = {
  FULL_NAME: "name",
  FIRST_NAME: "vorname",
  LAST_NAME: "nachname",
  EMAIL: "email",
  WORK_EMAIL: "email",
  PHONE_NUMBER: "telefon",
  WORK_PHONE: "telefon",
  POSTAL_CODE: "plz",
  CITY: "ort",
};

export interface GoogleEingang {
  lead: EingangLead;
  /** google_key aus dem Body (gegen config.key prüfen) */
  googleKey: string | null;
}

export function leseGoogle(body: Record<string, unknown>): GoogleEingang {
  const lead = leererLead();
  const spalten = Array.isArray(body.user_column_data) ? body.user_column_data : [];
  for (const s of spalten) {
    if (!istObjekt(s)) continue;
    const id = typeof s.column_id === "string" ? s.column_id : "";
    const name = wert(s.column_name);
    const w = wert(s.string_value);
    if (!w) continue;
    const k = GOOGLE_SPALTEN[id.toUpperCase()];
    if (k) setzeKontakt(lead, k, w, name ?? id);
    else feld(lead, id || name || "Angabe", name ?? googleFrage(id), w);
  }
  lead.externalId = idText(body.lead_id);
  lead.kampagneId = idText(body.campaign_id);
  lead.anzeigengruppe = idText(body.adgroup_id);
  lead.formular = idText(body.form_id);
  lead.kampagne = lead.kampagneId ? `Google Ads ${lead.kampagneId}` : "Google Ads";
  const gclid = idText(body.gcl_id);
  if (gclid) lead.utm.gclid = gclid;
  lead.utm.source = "google";
  lead.utm.medium = "lead_form";
  lead.test = body.is_test === true || body.is_test === "true";
  return { lead, googleKey: typeof body.google_key === "string" ? body.google_key : null };
}

/** „SERVICE_TYPE“ → „Service type“ (falls Google keinen column_name schickt) */
function googleFrage(id: string): string {
  const t = id.replace(/_/g, " ").toLowerCase().trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "Angabe";
}

// ---------------------------------------------------------------------------
// Allgemeiner Webhook (JSON / Formular)
// ---------------------------------------------------------------------------

/** Erlaubte Ziele in config.mapping (Lead-Feld → Punkt-Pfad im Body) */
export const MAPPING_ZIELE = ["vorname", "nachname", "name", "email", "telefon", "plz", "ort", "anliegen", "external_id", "kampagne", "formular"] as const;
export type MappingZiel = (typeof MAPPING_ZIELE)[number];

/** Wert per Punkt-Pfad („contact.phone“, „answers.0.value“) */
export function perPfad(obj: unknown, pfad: string): unknown {
  let akt: unknown = obj;
  for (const teil of pfad.split(".")) {
    if (teil === "__proto__" || teil === "constructor" || teil === "prototype") return undefined;
    if (Array.isArray(akt) && /^\d+$/.test(teil)) akt = akt[Number(teil)];
    else if (istObjekt(akt) && Object.prototype.hasOwnProperty.call(akt, teil)) akt = akt[teil];
    else return undefined;
  }
  return akt;
}

/** Verschachteltes Objekt in Punkt-Pfade auflösen (max. 4 Ebenen) */
export function flach(obj: unknown, praefix = "", tiefe = 0, out: Array<[string, unknown]> = []): Array<[string, unknown]> {
  if (istObjekt(obj) && !("value" in obj && Object.keys(obj).length <= 3) && tiefe < 4) {
    for (const [k, v] of Object.entries(obj)) flach(v, praefix ? `${praefix}.${k}` : k, tiefe + 1, out);
  } else if (Array.isArray(obj) && obj.some((x) => istObjekt(x)) && tiefe < 4) {
    obj.forEach((v, i) => {
      // [{ name|label|question, value|answer }] → Frage/Antwort
      if (istObjekt(v)) {
        const frage = wert(v.label) ?? wert(v.question) ?? wert(v.frage) ?? wert(v.title) ?? wert(v.name);
        const antwort = "values" in v ? wert(v.values) : wert(v.answer) ?? wert(v.antwort) ?? wert(v.value);
        if (frage && antwort !== null && Object.keys(v).length <= 4) {
          out.push([frage, antwort]);
          return;
        }
      }
      flach(v, `${praefix}.${i}`, tiefe + 1, out);
    });
  } else if (praefix) {
    out.push([praefix, obj]);
  }
  return out;
}

const WEBHOOK_INTERN = new Set(["formid", "form", "formname", "formular", "campaign", "kampagne", "campaignname", "campaignid", "adgroup", "adgroupid", "adset", "adsetname", "token", "secret", "key", "apikey"]);

export function leseWebhook(body: Record<string, unknown>, mapping: Partial<Record<MappingZiel, string>> = {}): EingangLead {
  const lead = leererLead();
  const benutzt = new Set<string>();

  for (const ziel of MAPPING_ZIELE) {
    const pfad = mapping[ziel];
    if (!pfad) continue;
    const w = wert(perPfad(body, pfad));
    benutzt.add(pfad);
    if (!w) continue;
    if (ziel === "external_id") lead.externalId = w.slice(0, 200);
    else if (ziel === "kampagne") lead.kampagne = kurz(w);
    else if (ziel === "formular") lead.formular = kurz(w);
    else setzeKontakt(lead, ziel, w, ziel);
  }

  for (const [pfad, v] of flach(body)) {
    if (benutzt.has(pfad)) continue;
    const w = wert(v);
    if (!w) continue;
    const letzter = pfad.split(".").pop() ?? pfad;
    const n = norm(letzter);
    if (!lead.externalId && ["id", "leadid", "submissionid", "externalid", "entryid"].includes(n)) {
      lead.externalId = w.slice(0, 200);
      continue;
    }
    if (["campaign", "kampagne", "campaignname"].includes(n)) {
      lead.kampagne ??= kurz(w);
      continue;
    }
    if (n === "campaignid") {
      lead.kampagneId ??= kurz(w);
      continue;
    }
    if (["adgroup", "adgroupid", "adset", "adsetname", "anzeigengruppe"].includes(n)) {
      lead.anzeigengruppe ??= kurz(w);
      continue;
    }
    if (["formid", "form", "formname", "formular"].includes(n)) {
      lead.formular ??= kurz(w);
      continue;
    }
    if (WEBHOOK_INTERN.has(n)) continue;
    if (["gclid", "fbclid", "wbraid", "gbraid"].includes(n)) {
      lead.utm[n] ??= w.slice(0, 200);
      continue;
    }
    feld(lead, letzter, letzter === pfad ? null : pfad, w);
  }
  lead.kampagne ??= kurz(lead.utm.campaign ?? null);
  return lead;
}

/** config.mapping aus der Datenbank lesen — nur erlaubte Ziele, nur einfache Pfade */
export function leseMapping(roh: unknown): Partial<Record<MappingZiel, string>> {
  const out: Partial<Record<MappingZiel, string>> = {};
  if (!istObjekt(roh)) return out;
  for (const ziel of MAPPING_ZIELE) {
    const p = roh[ziel];
    if (typeof p === "string" && /^[\w-]+(\.[\w-]+){0,5}$/.test(p.trim())) out[ziel] = p.trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Meta (Leadformulare)
// ---------------------------------------------------------------------------

export interface MetaAenderung {
  leadgenId: string;
  pageId: string | null;
  formId: string | null;
  adId: string | null;
  adgroupId: string | null;
  campaignId: string | null;
}

/** entry[].changes[].value (field = leadgen) aus dem Meta-Webhook */
export function leseMetaAenderungen(body: unknown): MetaAenderung[] {
  const out: MetaAenderung[] = [];
  if (!istObjekt(body) || !Array.isArray(body.entry)) return out;
  for (const e of body.entry) {
    if (!istObjekt(e) || !Array.isArray(e.changes)) continue;
    for (const c of e.changes) {
      if (!istObjekt(c) || (c.field !== undefined && c.field !== "leadgen") || !istObjekt(c.value)) continue;
      const v = c.value;
      const leadgenId = idText(v.leadgen_id);
      if (!leadgenId) continue;
      out.push({
        leadgenId,
        pageId: idText(v.page_id) ?? idText(e.id),
        formId: idText(v.form_id),
        adId: idText(v.ad_id),
        adgroupId: idText(v.adgroup_id),
        campaignId: idText(v.campaign_id),
      });
    }
  }
  return out;
}

/** Standardfelder der Meta-Leadformulare (field_data[].name) → Kontaktfeld */
const META_FELDER: Record<string, KontaktFeld> = {
  full_name: "name",
  first_name: "vorname",
  last_name: "nachname",
  email: "email",
  work_email: "email",
  phone_number: "telefon",
  work_phone_number: "telefon",
  zip_code: "plz",
  post_code: "plz",
  city: "ort",
};

/** „wann_soll_es_losgehen?“ → „Wann soll es losgehen?“ */
function metaFrage(name: string): string {
  const t = name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "Angabe";
}

/** Graph-API-Antwort GET /{leadgen_id}?fields=field_data,created_time,ad_name,adset_name,campaign_name,form_id */
export function leseMetaLead(graph: Record<string, unknown>, a: MetaAenderung): EingangLead {
  const lead = leererLead();
  const felder = Array.isArray(graph.field_data) ? graph.field_data : [];
  for (const f of felder) {
    if (!istObjekt(f) || typeof f.name !== "string") continue;
    const w = wert(f.values);
    if (!w) continue;
    const k = META_FELDER[f.name.toLowerCase()];
    if (k) setzeKontakt(lead, k, w, metaFrage(f.name));
    else feld(lead, f.name, metaFrage(f.name), w);
  }
  lead.externalId = a.leadgenId;
  lead.formular = kurz(idText(graph.form_id) ?? a.formId);
  lead.kampagne = kurz(wert(graph.campaign_name) ?? null);
  lead.kampagneId = kurz(idText(graph.campaign_id) ?? a.campaignId);
  lead.anzeigengruppe = kurz(wert(graph.adset_name) ?? idText(graph.adset_id) ?? a.adgroupId);
  lead.utm.source = "facebook";
  lead.utm.medium = "lead_form";
  const anzeige = wert(graph.ad_name) ?? a.adId;
  if (anzeige) lead.utm.content = anzeige.slice(0, 200);
  if (graph.is_organic === true) lead.utm.organisch = "ja";
  return lead;
}

export interface MetaQuelle {
  id: string;
  company_id: string;
  aktiv: boolean;
  config: Record<string, unknown> | null;
}

/** Seiten-ID + Formular-IDs aus config lesen */
export function metaConfig(config: unknown): { pageId: string | null; formIds: string[]; tokenEnv: string | null } {
  const c = istObjekt(config) ? config : {};
  const pageId = typeof c.page_id === "string" && /^\d{3,30}$/.test(c.page_id.trim()) ? c.page_id.trim() : null;
  const formIds = (Array.isArray(c.form_ids) ? c.form_ids : typeof c.form_ids === "string" ? c.form_ids.split(/[\s,;]+/) : [])
    .map((x) => String(x).trim())
    .filter((x) => /^\d{3,30}$/.test(x));
  const tokenEnv = typeof c.token_env === "string" && META_TOKEN_ENV.test(c.token_env) ? c.token_env : null;
  return { pageId, formIds, tokenEnv };
}

/**
 * Seiten-Token je Quelle: nur Env-Variablen mit diesem Präfix (Token liegen nie in der Datenbank
 * und nie im Browser; config kann so keine fremden Geheimnisse wie den Service-Key ansprechen).
 */
export const META_TOKEN_ENV = /^META_PAGE_TOKEN_[A-Z0-9_]{1,60}$/;
/** Standard-Token (Systemnutzer mit leads_retrieval für alle Seiten) */
export const META_STANDARD_TOKEN_ENV = "META_LEADS_ACCESS_TOKEN";

/**
 * Welche Quelle bekommt den Lead? Gleiche Seite + Formular in form_ids gewinnt,
 * sonst Quelle derselben Seite ohne Formular-Liste. Nur aktive Quellen.
 */
export function metaZuordnung<Q extends MetaQuelle>(quellen: Q[], pageId: string | null, formId: string | null): Q | null {
  if (!pageId) return null;
  const passend = quellen.filter((q) => q.aktiv && metaConfig(q.config).pageId === pageId);
  const mitFormular = passend.find((q) => formId && metaConfig(q.config).formIds.includes(formId));
  if (mitFormular) return mitFormular;
  return passend.find((q) => metaConfig(q.config).formIds.length === 0) ?? null;
}

// ---------------------------------------------------------------------------
// Prüfen, Dedupe, Sicherheit
// ---------------------------------------------------------------------------

/** null = in Ordnung, sonst Fehlertext fürs Protokoll */
export function pruefeLead(l: EingangLead): string | null {
  const name = (l.vorname + l.nachname).trim();
  const kontakt = l.email || l.telefon;
  if (!name && !kontakt) return "Weder Name noch Telefon/E-Mail im Lead – nichts gespeichert";
  return null;
}

/** Kalendertag in Berlin (YYYY-MM-DD) */
export function berlinTag(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Schlüssel gegen doppelte Leads (leads.external_id, eindeutig je Firma):
 * ID des Lead-Systems („perspective:abc“) — sonst Hash aus E-Mail/Telefon + Tag („h:…“),
 * damit ein doppelt abgeschicktes Formular am selben Tag nur einen Lead ergibt.
 */
export function dedupeSchluessel(art: QuellenArt, l: Pick<EingangLead, "externalId" | "email" | "telefon">, jetzt: Date): string {
  if (l.externalId) return `${art}:${l.externalId}`.slice(0, 250);
  const kontakt = [l.email?.toLowerCase() ?? "", l.telefon ? (telefonE164(l.telefon) ?? l.telefon) : ""].join("|");
  return `h:${createHash("sha256").update(`${kontakt}|${berlinTag(jetzt)}`).digest("hex").slice(0, 40)}`;
}

/** Zeitkonstanter Vergleich zweier Texte */
export function gleichSicher(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

/** X-Hub-Signature-256 („sha256=<hex>“) über den Roh-Body mit dem App-Secret prüfen */
export function metaSignaturGueltig(rohBody: string, header: string | null | undefined, appSecret: string | null | undefined): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  const erwartet = createHmac("sha256", appSecret).update(rohBody, "utf8").digest("hex");
  const gesendet = header.slice("sha256=".length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(gesendet)) return false;
  return timingSafeEqual(Buffer.from(erwartet, "hex"), Buffer.from(gesendet, "hex"));
}

/** Zufälliger, URL-sicherer Token (Standard 32 Byte → 43 Zeichen) */
export function neuerToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function istToken(t: string | null | undefined): t is string {
  return !!t && /^[A-Za-z0-9_-]{32,100}$/.test(t);
}

// ---------------------------------------------------------------------------
// Body lesen, Lead-Zeile bauen
// ---------------------------------------------------------------------------

/** JSON oder form-urlencoded (Content-Type egal, Inhalt entscheidet) */
export function leseBody(roh: string): Record<string, unknown> | null {
  const t = roh.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t);
      return istObjekt(j) ? j : null;
    } catch {
      return null;
    }
  }
  if (t.startsWith("[")) return null;
  const p = new URLSearchParams(t);
  const out: Record<string, unknown> = {};
  for (const [k, v] of p) {
    if (k in out) out[k] = [...(Array.isArray(out[k]) ? (out[k] as unknown[]) : [out[k]]), v];
    else out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export const TEST_HINWEIS: Antwort = { frage: "Hinweis", antwort: "Testlead – kein echter Kunde, bitte nicht anrufen" };

/** Insert-Objekt für public.leads */
export function leadZeile(
  l: EingangLead,
  q: { id: string; company_id: string; art: QuellenArt; name: string | null },
  schluessel: string,
  payload: unknown,
): Record<string, unknown> {
  const antworten = l.test && !l.antworten.some((a) => a.frage === TEST_HINWEIS.frage) ? [TEST_HINWEIS, ...l.antworten] : l.antworten;
  const utm = l.test ? { ...l.utm, test: "ja" } : l.utm;
  return {
    company_id: q.company_id,
    vorname: l.vorname || (l.test ? "Test" : ""),
    nachname: l.nachname,
    telefon: l.telefon,
    email: l.email,
    plz: l.plz,
    ort: l.ort,
    anliegen: l.anliegen,
    quelle: LEAD_QUELLE_FUER[q.art],
    campaign: l.kampagne ?? q.name ?? null,
    form_payload: payload ?? null,
    status: "neu",
    quelle_id: q.id,
    external_id: schluessel,
    antworten,
    utm,
    anzeigengruppe: l.anzeigengruppe,
    formular: l.formular,
    kampagne_id: l.kampagneId,
  };
}

/** Anzeigename eines Leads („Max Mustermann“, sonst Kontakt) */
export function leadName(l: Pick<EingangLead, "vorname" | "nachname" | "email" | "telefon">): string {
  return [l.vorname, l.nachname].filter(Boolean).join(" ").trim() || l.email || l.telefon || "Unbekannt";
}

/** Text der Benachrichtigung an den Betrieb */
export function benachrichtigungText(l: EingangLead): { titel: string; text: string } {
  const titel = `${l.test ? "Testlead" : "Neue Anfrage"}: ${leadName(l)}`;
  const teile = [l.ort ? [l.plz, l.ort].filter(Boolean).join(" ") : l.plz, l.anliegen ?? l.antworten.find((a) => a.frage !== TEST_HINWEIS.frage)?.antwort ?? null]
    .filter(Boolean)
    .map((s) => String(s).replace(/\s+/g, " ").slice(0, 140));
  return { titel: titel.slice(0, 150), text: teile.join(" · ") || "Jetzt anrufen – je schneller, desto besser." };
}

/** Beispiel-Bodies für „Testlead senden“ (laufen durch denselben Parser) */
export function testBody(art: QuellenArt, jetzt: Date): Record<string, unknown> {
  const id = `test-${jetzt.getTime().toString(36)}-${randomBytes(3).toString("hex")}`;
  switch (art) {
    case "perspective":
      return {
        id,
        funnelName: "Testlead",
        profile: {
          first_name: { value: "Test", title: "Vorname" },
          last_name: { value: "Lead", title: "Nachname" },
          email: { value: "test@example.com", title: "E-Mail" },
          phone: { value: "0151 00000000", title: "Telefonnummer" },
          wunsch: { value: "Badsanierung", title: "Was planen Sie?" },
        },
        test: true,
      };
    case "google":
      return {
        lead_id: id,
        user_column_data: [
          { column_id: "FULL_NAME", column_name: "Full Name", string_value: "Test Lead" },
          { column_id: "PHONE_NUMBER", column_name: "User Phone", string_value: "+4915100000000" },
          { column_id: "EMAIL", column_name: "User Email", string_value: "test@example.com" },
          { column_id: "POSTAL_CODE", column_name: "Postal Code", string_value: "10115" },
        ],
        is_test: true,
      };
    case "meta":
      return {
        id,
        field_data: [
          { name: "full_name", values: ["Test Lead"] },
          { name: "phone_number", values: ["+4915100000000"] },
          { name: "email", values: ["test@example.com"] },
          { name: "was_planen_sie?", values: ["Badsanierung"] },
        ],
        campaign_name: "Testlead",
      };
    case "webhook":
      return { id, name: "Test Lead", telefon: "0151 00000000", email: "test@example.com", plz: "10115", nachricht: "Testanfrage" };
  }
}
