import type { QuellenArt } from "@/lib/eingang/logik";

export const ART_LABEL: Record<QuellenArt, string> = {
  perspective: "Perspective-Funnel",
  meta: "Meta-Leadformular (Facebook/Instagram)",
  google: "Google-Ads-Leadformular",
  webhook: "Webhook (Website, Zapier, Make …)",
};

/** Kurze Anleitung je Art – wo die Angaben beim Anbieter eingetragen werden */
export const ANLEITUNG: Record<QuellenArt, string[]> = {
  perspective: [
    "In Perspective den Funnel öffnen und bei den Integrationen einen Webhook hinzufügen.",
    "Die URL oben als Webhook-Adresse einfügen und speichern.",
    "Eine Probe-Eintragung im Funnel machen – sie erscheint unten im Protokoll.",
  ],
  google: [
    "In Google Ads das Lead-Formular (Asset) der Kampagne öffnen und zum Abschnitt für den Lead-Export bzw. die Webhook-Integration gehen.",
    "Die URL als Webhook-URL und den Schlüssel unten als Schlüssel (Key) eintragen.",
    "Mit „Testdaten senden“ prüfen – der Testlead wird gespeichert und als Test markiert.",
  ],
  meta: [
    "Meta-Leads kommen über eine zentrale URL für alle Kunden: Meta-App → Webhooks → Objekt „Page“ → Feld „leadgen“ abonnieren (Callback-URL und Bestätigungs-Token siehe unten).",
    "Die Facebook-Seite des Kunden muss die App abonniert haben (subscribed_apps mit leadgen), und der Systemnutzer-Token braucht die Berechtigung leads_retrieval für diese Seite.",
    "Hier die Seiten-ID eintragen; Formular-IDs nur, wenn mehrere Kunden dieselbe Seite nutzen.",
    "Mit dem Lead-Ads-Testtool von Meta einen Probe-Lead schicken.",
  ],
  webhook: [
    "Die URL per POST aufrufen – JSON oder normales Formular (form-urlencoded).",
    "Erkannt werden u. a. name, vorname, nachname, telefon/phone, email, plz, ort, nachricht. Alles andere landet als Angabe beim Lead.",
    "Felder mit anderen Namen? Unten eine Zuordnung eintragen, z. B. telefon = kontakt.handy",
  ],
};

export const STATUS_LABEL: Record<string, { text: string; klasse: string }> = {
  ok: { text: "Gespeichert", klasse: "bg-emerald-100 text-emerald-800" },
  duplikat: { text: "Doppelt", klasse: "bg-gray-100 text-gray-700" },
  fehler: { text: "Fehler", klasse: "bg-red-100 text-red-800" },
  abgelehnt: { text: "Abgelehnt", klasse: "bg-amber-100 text-amber-800" },
};
