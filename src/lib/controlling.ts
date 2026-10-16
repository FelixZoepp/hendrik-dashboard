// Sales-Controlling: reine Berechnungen auf den gesyncten Close-/Calendly-/Meta-Daten.
// Läuft serverseitig — an den Client gehen nur die fertigen Kennzahlen.

import { categorizeCancelReason } from "@/lib/sales-utils";
import { berlinDateString, berlinDayStart, type Period } from "@/lib/period-utils";
import { PROTOKOLL } from "@/lib/close-team";

// ---------------------------------------------------------------------------
// Eingangsdaten
// ---------------------------------------------------------------------------

export interface CUser {
  close_id: string;
  name: string;
  email: string | null;
}

export interface COpp {
  close_id: string;
  lead_id: string | null;
  value: number | null;
  status_type: string | null;
  status_label: string | null;
  confidence: number | null;
  user_id: string | null;
  date_won: string | null;
  date_created: string | null;
}

export interface CCall {
  lead_id: string | null;
  user_id: string | null;
  duration: number | null;
  disposition: string | null;
  direction: string | null;
  date_created: string;
}

export interface CEvent {
  calendly_uri: string;
  event_type_name: string | null;
  invitee_name: string | null;
  invitee_email: string | null;
  status: string;
  no_show: boolean;
  canceled_by: string | null;
  cancel_reason: string | null;
  scheduled_at: string;
  created_at: string | null;
  host_email: string | null;
  utm: Record<string, string> | null;
}

export interface CMeta {
  date: string;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
}

export interface CSync {
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records: number | null;
  error: string | null;
}

/** Close-Gesprächsprotokoll (close_custom_activities), Felder als "custom.cf_…" */
export interface CProtokoll {
  lead_id: string;
  user_id: string | null;
  custom_activity_type_id: string;
  date_created: string;
  fields: Record<string, unknown> | null;
}

/** Cold Call: „Nächster Schritt“ bei erreichtem Entscheider (Wert „Setting vereinbart am:“ = Termin gelegt) */
const CC_ENTSCHEIDER_FELD = "custom.cf_rYzdqWeplRWv7FFbrhgaXOhKSUxhYgopFVpUmLHFruf";

/** Feld „Nächster Schritt“ je Protokolltyp und der Wert für No-Show (so in Close gepflegt) */
const PROTOKOLL_ERGEBNIS = {
  erst: { typ: PROTOKOLL.setting, feld: "custom.cf_6Kt9RVMkQiuDOXBiiTRrKg8DTwvoQn8EEBCXmaTykGZ", noShow: "No-Show" },
  strategie: { typ: PROTOKOLL.closing, feld: "custom.cf_9vkQK8YANMMZ3lyt0aAZbAnkAxYoB15WwM5sTyr3veM", noShow: "No SHow" },
} as const;

export interface ControllingInput {
  period: Period;
  users: CUser[];
  opps: COpp[]; // alle Opportunities
  calls: CCall[]; // Calls ab prevStart (bzw. periodStart)
  events: CEvent[]; // Calendly ab prevStart bis +60 Tage
  protokolle: CProtokoll[]; // Close-Protokolle ab prevStart
  meta: CMeta[]; // ab prevStart
  leadsNew: number;
  leadsNewPrev: number | null;
  syncs: CSync[];
  dbTotals: Record<string, number | null>;
  closeTotals: { leads: number | null; opportunities: number | null; wonOpportunities: number | null } | null;
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

export type TerminTyp = "erst" | "strategie" | "onboarding" | "absprache" | "sonstige";

export function terminTyp(name: string | null): TerminTyp {
  const n = (name ?? "").toLowerCase();
  if (n.includes("erstgespräch") || n.includes("erstgespraech")) return "erst";
  if (n.includes("strategiegespräch") || n.includes("strategiegespraech") || n.includes("beratungsgespräch"))
    return "strategie";
  if (n.includes("onboarding")) return "onboarding";
  if (n.includes("absprache") || n.includes("service-call")) return "absprache";
  return "sonstige";
}

export const TERMIN_LABEL: Record<TerminTyp, string> = {
  erst: "Erstgespräch",
  strategie: "Strategiegespräch",
  onboarding: "Onboarding",
  absprache: "Absprache / Service",
  sonstige: "Sonstige",
};

const isShow = (e: CEvent) => e.status === "active" && !e.no_show;
/** Erreicht = Close-Disposition "answered" (ohne Disposition: Dauer > 30 s). */
const isReached = (c: CCall) =>
  c.disposition ? c.disposition === "answered" : (c.duration ?? 0) > 30;
/** Echtes Gespräch = erreicht und länger als 1 Minute ("answered" enthält auch kurze Abnehmer). */
const isConversation = (c: CCall) => isReached(c) && (c.duration ?? 0) > 60;
const uniqueLeads = (cs: CCall[]) => new Set(cs.map((c) => c.lead_id).filter(Boolean)).size;

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

function inRange(iso: string | null, from: Date, to: Date) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}

const berlin = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
function berlinSlot(iso: string): { tag: number; stunde: number } {
  const parts = berlin.formatToParts(new Date(iso));
  const wd = (parts.find((p) => p.type === "weekday")?.value ?? "Mo").replace(".", "");
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return { tag: Math.max(0, WEEKDAYS.indexOf(wd)), stunde: h };
}

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

export interface Kpi {
  value: number | null;
  prev: number | null;
}

/** Opener-Auswertung: Termine aus Cold-Call-Protokollen („Setting vereinbart am:“) im Zeitraum und was daraus wurde */
export interface OpenerZeile {
  userId: string;
  name: string;
  termineGelegt: number;
  stattgefunden: number;
  noShow: number;
  /** noch kein Setting-Protokoll (Termin steht aus oder wurde nicht protokolliert) */
  offen: number;
  showRate: number | null;
  closingsGelegt: number;
  deals: number;
  umsatz: number;
}

export interface FunnelStufe {
  key: string;
  label: string;
  hint?: string;
  count: number;
  rateVorher: number | null; // Conversion von der Bezugsstufe (meist die vorherige)
  kostenJe: number | null; // Ad Spend / count
}

export interface TeamZeile {
  closeId: string;
  name: string;
  anrufe: number;
  erreicht: number;
  erreichtQuote: number | null;
  gespraeche: number;
  gespraechszeit: number; // Sekunden
  avgDauer: number | null;
  /** Vom Setter im Zeitraum neu gebuchte Termine (Buchungsdatum) */
  termineNeu: number;
  /** Vom Setter gebuchte Termine, die im Zeitraum stattfinden sollten */
  termineGesetzt: number;
  termineStattgefunden: number;
  showRate: number | null;
  termineJe100: number | null;
  strategieGeführt: number;
  deals: number;
  umsatz: number;
  closingRate: number | null;
}

export interface TerminZeile {
  typ: TerminTyp;
  label: string;
  /** Im Zeitraum neu gebucht (Buchungsdatum), egal wann der Termin ist */
  neuGebucht: number;
  /** Termin liegt im Zeitraum (inkl. abgesagter), egal wann gebucht */
  geplant: number;
  stattgefunden: number;
  noShow: number;
  abgesagt: number;
  offen: number; // in der Zukunft
  showRate: number | null;
  avgVorlaufTage: number | null;
}

export interface TrendPunkt {
  label: string;
  erst: number;
  strategie: number;
  umsatz: number;
  anrufe: number;
  vorperiodeErst: number | null;
}

export interface Quoten {
  anrufe: number;
  erreicht: number;
  gespraeche: number;
}

export interface ErreichbarkeitSlot extends Quoten {
  tag: number; // Mo=0
  stunde: number;
}

export interface OpenerErreichbarkeit extends Quoten {
  closeId: string;
  name: string;
  aktiveTage: number;
  anrufeProTag: number | null;
  termine: number; // gesetzte Termine (Setter-Zuordnung)
  stunden: (Quoten & { stunde: number })[];
  wochentage: (Quoten & { tag: number })[];
  besteStunden: (Quoten & { stunde: number })[];
  schwaechsteStunde: (Quoten & { stunde: number }) | null;
}

export interface Erreichbarkeit {
  minAnrufe: number; // Mindestmenge, ab der eine Quote als belastbar gilt
  gesamt: Quoten;
  slots: ErreichbarkeitSlot[];
  stunden: (Quoten & { stunde: number })[];
  wochentage: (Quoten & { tag: number })[];
  besteSlots: ErreichbarkeitSlot[];
  schwaechsteSlots: ErreichbarkeitSlot[];
  buchungenProStunde: { stunde: number; count: number }[];
  opener: OpenerErreichbarkeit[];
}

export interface Warnung {
  level: "rot" | "gelb";
  text: string;
}

export interface ControllingReport {
  periodLabel: string;
  rangeLabel: string;
  prevRangeLabel: string | null;
  trendEinheit: string;
  hasPrev: boolean;
  kpis: {
    umsatz: Kpi;
    deals: Kpi;
    avgDeal: Kpi;
    pipelineWert: Kpi;
    pipelineAnzahl: number;
    forecast: number;
    closingRate: Kpi;
    adSpend: Kpi;
    cac: Kpi;
    roas: Kpi;
    leads: Kpi;
    anrufe: Kpi;
    leadsAngerufen: number;
    leadsErreicht: number;
    termine: Record<
      "erst" | "strategie",
      {
        neu: Kpi;
        geplant: number;
        stattgefunden: Kpi;
        noShow: number;
        abgesagt: number;
        /** davon verschoben: dieselbe Person hat danach neu gebucht */
        verschoben: number;
        ohneProtokoll: number;
        showRate: number | null;
      }
    >;
    showRateErst: Kpi;
    onboardings: Kpi;
  };
  funnel: FunnelStufe[];
  trend: TrendPunkt[];
  pipeline: { label: string; anzahl: number; wert: number }[];
  team: TeamZeile[];
  termine: TerminZeile[];
  absagegruende: { grund: string; anzahl: number }[];
  /** Ergebnisse („Nächster Schritt“) der Close-Protokolle im Zeitraum, je Lead das letzte */
  protokollErgebnisse: Record<"erst" | "strategie", { wert: string; anzahl: number; noShow: boolean }[]>;
  opener: OpenerZeile[];
  absagenVorlauf: { ueber24h: number; unter24h: number; unter2h: number };
  kommend: { name: string; typ: string; start: string }[];
  heatmapAnrufe: { tag: number; stunde: number; count: number }[];
  heatmapShows: { tag: number; stunde: number; count: number }[];
  kampagnen: { name: string; spend: number; leads: number; cpl: number | null; clicks: number }[];
  datenstand: {
    syncs: { source: string; zuletzt: string | null; status: string; records: number | null; error: string | null }[];
    totals: { label: string; db: number | null; close: number | null }[];
    metaLetzterTag: string | null;
    setterZugeordnet: number;
    termineMitEmail: number;
  };
  erreichbarkeit: Erreichbarkeit;
  warnungen: Warnung[];
}

// ---------------------------------------------------------------------------
// Berechnung
// ---------------------------------------------------------------------------

export function buildReport(input: ControllingInput): ControllingReport {
  const { period } = input;
  const now = period.end;
  const periodStart = period.start;
  const prevStart = period.prevStart;
  const prevEnd = period.prevEnd ?? periodStart;
  const hasPrev = prevStart !== null;

  const usersByEmail = new Map(
    input.users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u])
  );

  // --- Periodenschnitte ---
  const calls = input.calls.filter((c) => inRange(c.date_created, periodStart, now));
  const callsPrev = hasPrev ? input.calls.filter((c) => inRange(c.date_created, prevStart!, prevEnd)) : [];
  const events = input.events.filter((e) => inRange(e.scheduled_at, periodStart, now));
  const eventsPrev = hasPrev ? input.events.filter((e) => inRange(e.scheduled_at, prevStart!, prevEnd)) : [];
  const kommendeEvents = input.events
    .filter((e) => e.status === "active" && new Date(e.scheduled_at) >= now)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  // Meta liefert Tageswerte → Vergleich über Kalenderdaten (Berlin), Vorperiode = volle Tage davor
  const dPeriod = berlinDateString(periodStart);
  const dToday = berlinDateString(now);
  const meta = input.meta.filter((m) => m.date >= dPeriod && m.date <= dToday);
  const metaPrev = hasPrev
    ? input.meta.filter((m) => m.date >= berlinDateString(prevStart!) && m.date < dPeriod)
    : [];

  const won = input.opps.filter((o) => o.status_type === "won" && inRange(o.date_won, periodStart, now));
  const wonPrev = hasPrev
    ? input.opps.filter((o) => o.status_type === "won" && inRange(o.date_won, prevStart!, prevEnd))
    : [];
  const aktiv = input.opps.filter((o) => o.status_type === "active");

  const byTyp = (es: CEvent[], t: TerminTyp) => es.filter((e) => terminTyp(e.event_type_name) === t);

  // --- KPIs ---
  const umsatz = sum(won, (o) => o.value ?? 0);
  const umsatzPrev = sum(wonPrev, (o) => o.value ?? 0);
  const adSpend = sum(meta, (m) => Number(m.spend));
  const adSpendPrev = sum(metaPrev, (m) => Number(m.spend));
  const erst = byTyp(events, "erst");
  const erstPrev = byTyp(eventsPrev, "erst");
  const erstVergangen = erst.filter((e) => e.status === "active");
  const erstVergangenPrev = erstPrev.filter((e) => e.status === "active");
  const pv = <T>(v: T) => (hasPrev ? v : null);
  const neuGebucht = (t: TerminTyp, from: Date, to: Date) =>
    input.events.filter((e) => e.created_at && inRange(e.created_at, from, to) && terminTyp(e.event_type_name) === t).length;
  // Stattgefunden/No-Show kommen aus den Close-Protokollen (Calendly-No-Shows pflegt niemand), Absagen aus Calendly
  const ergebnisse = (t: "erst" | "strategie", from: Date, to: Date) => {
    const { typ, feld, noShow } = PROTOKOLL_ERGEBNIS[t];
    const jeLead = new Map<string, CProtokoll>();
    for (const p of input.protokolle) {
      if (p.custom_activity_type_id !== typ || !p.fields?.[feld] || !inRange(p.date_created, from, to)) continue;
      const alt = jeLead.get(p.lead_id);
      if (!alt || alt.date_created < p.date_created) jeLead.set(p.lead_id, p);
    }
    const werte = [...jeLead.values()].map((p) => String(p.fields![feld]));
    return { werte, noShow: werte.filter((w) => w === noShow).length, erschienen: werte.filter((w) => w !== noShow).length };
  };
  const terminKpi = (t: "erst" | "strategie") => {
    const geplant = byTyp(events, t);
    const e = ergebnisse(t, periodStart, now);
    const ePrev = hasPrev ? ergebnisse(t, prevStart!, prevEnd!) : null;
    const nichtAbgesagt = geplant.filter((x) => x.status === "active").length;
    const abgesagt = geplant.filter((x) => x.status === "canceled");
    // Verschoben = dieselbe Person hat nach dieser Buchung einen weiteren Termin gleichen Typs gebucht
    const verschoben = abgesagt.filter((x) => {
      const email = x.invitee_email?.toLowerCase();
      return (
        !!email &&
        input.events.some(
          (y) =>
            y !== x &&
            y.invitee_email?.toLowerCase() === email &&
            terminTyp(y.event_type_name) === t &&
            (y.created_at ?? "") > (x.created_at ?? ""),
        )
      );
    }).length;
    return {
      neu: { value: neuGebucht(t, periodStart, now), prev: hasPrev ? neuGebucht(t, prevStart!, prevEnd!) : null },
      geplant: geplant.length,
      stattgefunden: { value: e.erschienen, prev: ePrev ? ePrev.erschienen : null },
      noShow: e.noShow,
      abgesagt: abgesagt.length,
      verschoben,
      ohneProtokoll: Math.max(0, nichtAbgesagt - e.erschienen - e.noShow),
      showRate: ratio(e.erschienen, e.erschienen + e.noShow),
    };
  };
  const terminKpis = { erst: terminKpi("erst"), strategie: terminKpi("strategie") };
  const zaehle = (werte: string[], noShow: string) => {
    const m = new Map<string, number>();
    for (const w of werte) m.set(w, (m.get(w) ?? 0) + 1);
    return [...m.entries()].map(([wert, anzahl]) => ({ wert, anzahl, noShow: wert === noShow })).sort((a, b) => b.anzahl - a.anzahl);
  };
  const protokollErgebnisse = {
    erst: zaehle(ergebnisse("erst", periodStart, now).werte, PROTOKOLL_ERGEBNIS.erst.noShow),
    strategie: zaehle(ergebnisse("strategie", periodStart, now).werte, PROTOKOLL_ERGEBNIS.strategie.noShow),
  };

  const kpis: ControllingReport["kpis"] = {
    umsatz: { value: umsatz, prev: pv(umsatzPrev) },
    deals: { value: won.length, prev: pv(wonPrev.length) },
    avgDeal: { value: ratio(umsatz, won.length), prev: pv(ratio(umsatzPrev, wonPrev.length)) },
    pipelineWert: { value: sum(aktiv, (o) => o.value ?? 0), prev: null },
    pipelineAnzahl: aktiv.length,
    forecast: sum(aktiv, (o) => ((o.value ?? 0) * (o.confidence ?? 0)) / 100),
    closingRate: {
      value: ratio(won.length, terminKpis.strategie.stattgefunden.value ?? 0),
      prev: pv(ratio(wonPrev.length, terminKpis.strategie.stattgefunden.prev ?? 0)),
    },
    adSpend: { value: adSpend, prev: pv(adSpendPrev) },
    cac: { value: ratio(adSpend, won.length), prev: pv(ratio(adSpendPrev, wonPrev.length)) },
    roas: { value: ratio(umsatz, adSpend), prev: pv(ratio(umsatzPrev, adSpendPrev)) },
    leads: { value: input.leadsNew, prev: input.leadsNewPrev },
    anrufe: { value: calls.length, prev: pv(callsPrev.length) },
    leadsAngerufen: uniqueLeads(calls),
    leadsErreicht: uniqueLeads(calls.filter(isReached)),
    termine: terminKpis,
    showRateErst: {
      value: ratio(erstVergangen.filter(isShow).length, erstVergangen.length),
      prev: pv(ratio(erstVergangenPrev.filter(isShow).length, erstVergangenPrev.length)),
    },
    onboardings: {
      value: byTyp(events, "onboarding").filter(isShow).length,
      prev: pv(byTyp(eventsPrev, "onboarding").filter(isShow).length),
    },
  };

  // --- Funnel ---
  // Mengen = eindeutige Leads bzw. Termine. `basis` = Index der Bezugsstufe für die Conversion.
  const stufen: (Omit<FunnelStufe, "rateVorher" | "kostenJe"> & { basis?: number })[] = [
    { key: "angerufen", label: `Leads angerufen (${calls.length.toLocaleString("de-DE")} Anrufe)`, count: uniqueLeads(calls) },
    { key: "erreicht", label: "Leads erreicht", count: uniqueLeads(calls.filter(isReached)) },
    { key: "gespraech", label: "Leads mit Gespräch > 1 min", count: uniqueLeads(calls.filter(isConversation)) },
    { key: "erstGebucht", label: "Erstgespräch geplant", hint: "Termin liegt im Zeitraum (inkl. abgesagter), egal wann gebucht", count: erst.length },
    { key: "erstShow", label: "Erstgespräch stattgefunden", hint: "laut Setting-Protokoll in Close", count: terminKpis.erst.stattgefunden.value ?? 0 },
    { key: "stratGebucht", label: "Strategie geplant", hint: "Termin liegt im Zeitraum (inkl. abgesagter), egal wann gebucht", count: byTyp(events, "strategie").length },
    { key: "stratShow", label: "Strategie stattgefunden", hint: "laut Closing-Protokoll in Close", count: terminKpis.strategie.stattgefunden.value ?? 0 },
    {
      key: "onboarding",
      label: "Onboarding",
      hint: "Conversion bezogen auf stattgefundene Strategiegespräche",
      count: kpis.onboardings.value ?? 0,
    },
    {
      key: "won",
      label: "Deal gewonnen (Close)",
      hint: "Conversion bezogen auf stattgefundene Strategiegespräche",
      count: won.length,
      basis: 6,
    },
  ];
  const funnel: FunnelStufe[] = stufen.map(({ basis, ...s }, i) => ({
    ...s,
    rateVorher: i === 0 ? null : ratio(s.count, stufen[basis ?? i - 1].count),
    kostenJe: adSpend > 0 && i >= 3 ? ratio(adSpend, s.count) : null,
  }));

  // --- Trend: Kalender-Buckets in Berlin (7T/30T: Tage, 90T: Wochen ab Montag, Max: Monate) ---
  const einheit: "tag" | "woche" | "monat" = period.allTime ? "monat" : period.days <= 31 ? "tag" : "woche";
  const dataStart = period.allTime
    ? new Date(Math.min(...input.events.map((e) => new Date(e.scheduled_at).getTime()), now.getTime()))
    : periodStart;
  const buckets: { from: Date; to: Date; label: string }[] = [];
  const fmtTag = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
  const fmtMonat = new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit", timeZone: "Europe/Berlin" });
  if (einheit === "tag") {
    for (let i = 0; i < period.days; i++) {
      const from = berlinDayStart(periodStart, i);
      buckets.push({ from, to: berlinDayStart(periodStart, i + 1), label: fmtTag.format(from) });
    }
  } else if (einheit === "woche") {
    // erster Bucket beginnt am Periodenstart, danach jeweils Montag 00:00
    let from = periodStart;
    while (from < now) {
      const dow = (new Date(from.getTime() + 12 * 3600_000).getUTCDay() + 6) % 7; // Mo=0 (Mittag vermeidet DST-Kanten)
      const to = berlinDayStart(from, 7 - dow);
      buckets.push({ from, to, label: `KW ${isoWeek(from)}` });
      from = to;
    }
  } else {
    let from = berlinDayStart(dataStart, 0);
    const f = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).format(d).split("-").map(Number);
    const [y0, m0] = f(from);
    for (let k = 0; ; k++) {
      const start = k === 0 ? from : berlinDayStart(new Date(Date.UTC(y0, m0 - 1 + k, 1, 12)), 0);
      if (start >= now) break;
      const end = berlinDayStart(new Date(Date.UTC(y0, m0 + k, 1, 12)), 0);
      buckets.push({ from: start, to: end, label: fmtMonat.format(start) });
      from = end;
    }
  }
  const shiftMs = period.prevStart ? periodStart.getTime() - period.prevStart.getTime() : 0;
  const trend: TrendPunkt[] = buckets.map(({ from, to: rawTo, label }) => {
    const to = rawTo > now ? now : rawTo;
    const ev = input.events.filter((e) => inRange(e.scheduled_at, from, to) && isShow(e));
    const pf = new Date(from.getTime() - shiftMs);
    const pt = new Date(to.getTime() - shiftMs);
    return {
      label,
      erst: ev.filter((e) => terminTyp(e.event_type_name) === "erst").length,
      strategie: ev.filter((e) => terminTyp(e.event_type_name) === "strategie").length,
      umsatz: sum(input.opps.filter((o) => o.status_type === "won" && inRange(o.date_won, from, to)), (o) => o.value ?? 0),
      anrufe: input.calls.filter((c) => inRange(c.date_created, from, to)).length,
      vorperiodeErst: hasPrev
        ? input.events.filter(
            (e) => inRange(e.scheduled_at, pf, pt) && isShow(e) && terminTyp(e.event_type_name) === "erst"
          ).length
        : null,
    };
  });

  // --- Pipeline ---
  const pipeMap = new Map<string, { anzahl: number; wert: number }>();
  for (const o of aktiv) {
    const k = o.status_label ?? "Ohne Status";
    const cur = pipeMap.get(k) ?? { anzahl: 0, wert: 0 };
    cur.anzahl++;
    cur.wert += o.value ?? 0;
    pipeMap.set(k, cur);
  }
  const pipeline = [...pipeMap.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.anzahl - a.anzahl);

  // --- Team ---
  // --- Opener: gelegte Termine laut Cold-Call-Protokoll → Setting-Ergebnis → Closing/Deal (Lead-basiert) ---
  const settingNachLead = new Map<string, CProtokoll[]>();
  for (const p of input.protokolle) {
    if (p.custom_activity_type_id !== PROTOKOLL_ERGEBNIS.erst.typ || !p.fields?.[PROTOKOLL_ERGEBNIS.erst.feld]) continue;
    settingNachLead.set(p.lead_id, [...(settingNachLead.get(p.lead_id) ?? []), p]);
  }
  const gelegt = new Map<string, { userId: string; datum: string }>();
  for (const p of input.protokolle) {
    if (p.custom_activity_type_id !== PROTOKOLL.coldCall || !p.user_id) continue;
    if (p.fields?.[CC_ENTSCHEIDER_FELD] !== "Setting vereinbart am:" || !inRange(p.date_created, periodStart, now)) continue;
    const alt = gelegt.get(p.lead_id);
    if (!alt || alt.datum < p.date_created) gelegt.set(p.lead_id, { userId: p.user_id, datum: p.date_created });
  }
  const openerMap = new Map<string, OpenerZeile>();
  for (const [leadId, g] of gelegt) {
    const z =
      openerMap.get(g.userId) ??
      {
        userId: g.userId,
        name: input.users.find((u) => u.close_id === g.userId)?.name ?? "Unbekannt",
        termineGelegt: 0, stattgefunden: 0, noShow: 0, offen: 0, showRate: null, closingsGelegt: 0, deals: 0, umsatz: 0,
      };
    z.termineGelegt++;
    // letztes Setting-Protokoll nach dem Legen entscheidet
    const s = (settingNachLead.get(leadId) ?? []).filter((p) => p.date_created > g.datum).sort((a, b) => a.date_created.localeCompare(b.date_created)).pop();
    const wert = s ? String(s.fields![PROTOKOLL_ERGEBNIS.erst.feld]) : null;
    if (!wert) z.offen++;
    else if (wert === PROTOKOLL_ERGEBNIS.erst.noShow) z.noShow++;
    else {
      z.stattgefunden++;
      if (wert === "Closing gelegt am:") z.closingsGelegt++;
    }
    const gewonnen = input.opps.filter((o) => o.lead_id === leadId && o.status_type === "won");
    z.deals += gewonnen.length;
    z.umsatz += sum(gewonnen, (o) => o.value ?? 0);
    openerMap.set(g.userId, z);
  }
  const opener = [...openerMap.values()]
    .map((z) => ({ ...z, showRate: ratio(z.stattgefunden, z.stattgefunden + z.noShow) }))
    .sort((a, b) => b.termineGelegt - a.termineGelegt);

  const team: TeamZeile[] = input.users
    .map((u) => {
      const uc = calls.filter((c) => c.user_id === u.close_id);
      const reached = uc.filter(isReached);
      const talk = sum(uc, (c) => c.duration ?? 0);
      const gesetzt = events.filter((e) => e.utm?._setter_user_id === u.close_id);
      const neu = input.events.filter(
        (e) => e.utm?._setter_user_id === u.close_id && e.created_at && inRange(e.created_at, periodStart, now),
      );
      const gesetztVergangen = gesetzt.filter((e) => e.status === "active" && new Date(e.scheduled_at) < now);
      const geführt = byTyp(events, "strategie").filter(
        (e) => isShow(e) && e.host_email && usersByEmail.get(e.host_email.toLowerCase())?.close_id === u.close_id
      ).length;
      const uw = won.filter((o) => o.user_id === u.close_id);
      return {
        closeId: u.close_id,
        name: u.name,
        anrufe: uc.length,
        erreicht: reached.length,
        erreichtQuote: ratio(reached.length, uc.length),
        gespraeche: uc.filter(isConversation).length,
        gespraechszeit: talk,
        avgDauer: ratio(
          sum(uc.filter(isConversation), (c) => c.duration ?? 0),
          uc.filter(isConversation).length
        ),
        termineNeu: neu.length,
        termineGesetzt: gesetzt.length,
        termineStattgefunden: gesetzt.filter(isShow).length,
        showRate: ratio(gesetzt.filter(isShow).length, gesetztVergangen.length),
        termineJe100: uc.length > 0 ? (neu.length / uc.length) * 100 : null,
        strategieGeführt: geführt,
        deals: uw.length,
        umsatz: sum(uw, (o) => o.value ?? 0),
        closingRate: ratio(uw.length, geführt),
      };
    })
    .filter((t) => t.anrufe + t.termineNeu + t.termineGesetzt + t.strategieGeführt + t.deals > 0)
    .sort((a, b) => b.umsatz - a.umsatz || b.termineGesetzt - a.termineGesetzt || b.anrufe - a.anrufe);

  // --- Termine ---
  const typen: TerminTyp[] = ["erst", "strategie", "onboarding", "absprache", "sonstige"];
  const termine: TerminZeile[] = typen
    .map((typ) => {
      const es = byTyp(events, typ);
      const vergangen = es.filter((e) => e.status === "active");
      const vorlauf = es
        .filter((e) => e.created_at && new Date(e.created_at) < new Date(e.scheduled_at))
        .map((e) => (new Date(e.scheduled_at).getTime() - new Date(e.created_at!).getTime()) / 86400_000)
        .filter((d) => d < 120);
      return {
        typ,
        label: TERMIN_LABEL[typ],
        neuGebucht: input.events.filter(
          (e) => e.created_at && inRange(e.created_at, periodStart, now) && terminTyp(e.event_type_name) === typ,
        ).length,
        geplant: es.length,
        stattgefunden: typ === "erst" || typ === "strategie" ? terminKpis[typ].stattgefunden.value ?? 0 : es.filter(isShow).length,
        noShow: typ === "erst" || typ === "strategie" ? terminKpis[typ].noShow : es.filter((e) => e.no_show).length,
        abgesagt: es.filter((e) => e.status === "canceled").length,
        offen: byTyp(kommendeEvents, typ).length,
        showRate: ratio(vergangen.filter(isShow).length, vergangen.length),
        avgVorlaufTage: vorlauf.length > 0 ? sum(vorlauf, (d) => d) / vorlauf.length : null,
      };
    })
    .filter((t) => t.neuGebucht + t.geplant + t.offen > 0);

  const abgesagt = events.filter((e) => e.status === "canceled");
  const gruende = new Map<string, number>();
  for (const e of abgesagt) {
    const g = categorizeCancelReason(e.cancel_reason);
    gruende.set(g, (gruende.get(g) ?? 0) + 1);
  }
  // Vorlauf einer Absage ist unbekannt (Calendly liefert keinen Absagezeitpunkt im Event) —
  // wir nutzen Buchung→Termin als Näherung nur für die Verteilung kurzfristiger Termine.
  const absagenVorlauf = { ueber24h: 0, unter24h: 0, unter2h: 0 };
  for (const e of abgesagt) {
    const h = e.created_at ? (new Date(e.scheduled_at).getTime() - new Date(e.created_at).getTime()) / 3600_000 : 999;
    if (h > 24) absagenVorlauf.ueber24h++;
    else if (h > 2) absagenVorlauf.unter24h++;
    else absagenVorlauf.unter2h++;
  }

  // --- Heatmaps (Europe/Berlin) ---
  function heat<T>(xs: T[], iso: (x: T) => string) {
    const m = new Map<string, number>();
    for (const x of xs) {
      const { tag, stunde } = berlinSlot(iso(x));
      const k = `${tag}-${stunde}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([k, count]) => {
      const [tag, stunde] = k.split("-").map(Number);
      return { tag, stunde, count };
    });
  }

  // --- Kampagnen ---
  const kampMap = new Map<string, { spend: number; leads: number; clicks: number }>();
  for (const m of meta) {
    const k = m.campaign_name ?? "Unbekannt";
    const cur = kampMap.get(k) ?? { spend: 0, leads: 0, clicks: 0 };
    cur.spend += Number(m.spend);
    cur.leads += m.leads;
    cur.clicks += m.clicks;
    kampMap.set(k, cur);
  }
  const kampagnen = [...kampMap.entries()]
    .map(([name, v]) => ({ name, ...v, cpl: ratio(v.spend, v.leads) }))
    .sort((a, b) => b.spend - a.spend);

  // --- Datenstand & Warnungen ---
  const lastBySource = new Map<string, CSync>();
  for (const s of input.syncs) if (!lastBySource.has(s.source)) lastBySource.set(s.source, s);
  const syncs = ["close", "calendly", "meta"].map((source) => {
    const s = lastBySource.get(source);
    return {
      source,
      zuletzt: s?.finished_at ?? s?.started_at ?? null,
      status: s?.status ?? "nie",
      records: s?.records ?? null,
      error: s?.error ?? null,
    };
  });
  const metaLetzterTag = input.meta.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null);
  const mitEmail = events.filter((e) => e.invitee_email);
  const setterZugeordnet = events.filter((e) => e.utm?._setter_user_id).length;

  const warnungen: Warnung[] = [];
  for (const s of syncs) {
    if (s.status === "error") warnungen.push({ level: "rot", text: `${s.source}-Sync fehlgeschlagen: ${s.error ?? "unbekannt"}` });
    else if (!s.zuletzt || now.getTime() - new Date(s.zuletzt).getTime() > 36 * 3600_000)
      warnungen.push({ level: "gelb", text: `${s.source}-Sync seit über 36 h nicht gelaufen` });
  }
  if (metaLetzterTag && now.getTime() - new Date(`${metaLetzterTag}T23:59:59Z`).getTime() > 3 * 86400_000)
    warnungen.push({
      level: "gelb",
      text: `Meta-Daten enden am ${new Date(metaLetzterTag).toLocaleDateString("de-DE")} — Kampagnen pausiert oder Token abgelaufen?`,
    });
  const onb = kpis.onboardings.value ?? 0;
  if (onb > won.length)
    warnungen.push({
      level: "gelb",
      text: `${onb} Onboardings, aber nur ${won.length} gewonnene Deals in Close — Opportunities in Close auf „gewonnen“ setzen, sonst fehlen Umsatz, CAC und ROAS.`,
    });
  const ct = input.closeTotals;
  if (ct?.opportunities != null && input.dbTotals.opportunities != null && ct.opportunities !== input.dbTotals.opportunities)
    warnungen.push({
      level: "gelb",
      text: `Opportunities: Close ${ct.opportunities} vs. Dashboard ${input.dbTotals.opportunities} — nächster Sync gleicht ab.`,
    });
  if (events.length > 0 && setterZugeordnet === 0)
    warnungen.push({
      level: "gelb",
      text: "Noch keine Termine einem Setter zugeordnet — wird nach dem nächsten Close- und Calendly-Sync befüllt.",
    });

  // --- Erreichbarkeit ---
  const erreichbarkeit = buildErreichbarkeit(calls, events, input.users);

  return {
    erreichbarkeit,
    periodLabel: period.label,
    rangeLabel: period.rangeLabel,
    prevRangeLabel: period.prevRangeLabel,
    trendEinheit: einheit === "tag" ? "pro Tag" : einheit === "woche" ? "pro Kalenderwoche" : "pro Monat",
    hasPrev,
    kpis,
    funnel,
    trend,
    pipeline,
    team,
    termine,
    protokollErgebnisse,
    opener,
    absagegruende: [...gruende.entries()].map(([grund, anzahl]) => ({ grund, anzahl })).sort((a, b) => b.anzahl - a.anzahl),
    absagenVorlauf,
    kommend: kommendeEvents.slice(0, 6).map((e) => ({
      name: e.invitee_name ?? "Unbekannt",
      typ: TERMIN_LABEL[terminTyp(e.event_type_name)],
      start: e.scheduled_at,
    })),
    heatmapAnrufe: heat(calls, (c) => c.date_created),
    heatmapShows: heat(events.filter(isShow), (e) => e.scheduled_at),
    kampagnen,
    datenstand: {
      syncs,
      totals: [
        { label: "Leads", db: input.dbTotals.leads, close: ct?.leads ?? null },
        { label: "Opportunities", db: input.dbTotals.opportunities, close: ct?.opportunities ?? null },
        { label: "Gewonnene Deals", db: input.dbTotals.won, close: ct?.wonOpportunities ?? null },
        { label: "Activities", db: input.dbTotals.activities, close: null },
        { label: "Calendly-Termine", db: input.dbTotals.events, close: null },
      ],
      metaLetzterTag,
      setterZugeordnet,
      termineMitEmail: mitEmail.length,
    },
    warnungen,
  };
}

/** ISO-Kalenderwoche eines Zeitpunkts (Berliner Datum). */
function isoWeek(d: Date): number {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d)
    .split("-")
    .map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow + 3);
  // t ist jetzt der Donnerstag dieser Woche → Woche = Anzahl Donnerstage seit Jahresbeginn
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return 1 + Math.floor((t.getTime() - jan1) / (7 * 86400_000));
}

// ---------------------------------------------------------------------------
// Erreichbarkeit: Wann gehen Leads ans Telefon — gesamt und je Opener
// ---------------------------------------------------------------------------

const SLOT_MIN = 20; // Anrufe je Wochentag×Stunde
const OPENER_STUNDE_MIN = 15; // Anrufe je Opener×Stunde

function quoten(cs: CCall[]): Quoten {
  return {
    anrufe: cs.length,
    erreicht: cs.filter(isReached).length,
    gespraeche: cs.filter(isConversation).length,
  };
}

const quote = (q: Quoten) => (q.anrufe > 0 ? q.erreicht / q.anrufe : 0);

function nachStunde(cs: CCall[]) {
  const m = new Map<number, CCall[]>();
  for (const c of cs) {
    const { stunde } = berlinSlot(c.date_created);
    (m.get(stunde) ?? m.set(stunde, []).get(stunde)!).push(c);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([stunde, xs]) => ({ stunde, ...quoten(xs) }));
}

function nachTag(cs: CCall[]) {
  const m = new Map<number, CCall[]>();
  for (const c of cs) {
    const { tag } = berlinSlot(c.date_created);
    (m.get(tag) ?? m.set(tag, []).get(tag)!).push(c);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([tag, xs]) => ({ tag, ...quoten(xs) }));
}

function buildErreichbarkeit(calls: CCall[], events: CEvent[], users: CUser[]): Erreichbarkeit {
  const slotMap = new Map<string, CCall[]>();
  for (const c of calls) {
    const { tag, stunde } = berlinSlot(c.date_created);
    const k = `${tag}-${stunde}`;
    (slotMap.get(k) ?? slotMap.set(k, []).get(k)!).push(c);
  }
  const slots: ErreichbarkeitSlot[] = [...slotMap.entries()].map(([k, xs]) => {
    const [tag, stunde] = k.split("-").map(Number);
    return { tag, stunde, ...quoten(xs) };
  });
  const belastbar = slots.filter((s) => s.anrufe >= SLOT_MIN);
  const sortiert = [...belastbar].sort((a, b) => quote(b) - quote(a) || b.anrufe - a.anrufe);

  // Wann setzen die Opener Termine? (Buchungszeitpunkt der zugeordneten Termine)
  const buch = new Map<number, number>();
  for (const e of events) {
    if (!e.utm?._setter_user_id || !e.created_at) continue;
    const { stunde } = berlinSlot(e.created_at);
    buch.set(stunde, (buch.get(stunde) ?? 0) + 1);
  }

  const opener: OpenerErreichbarkeit[] = users
    .map((u) => {
      const uc = calls.filter((c) => c.user_id === u.close_id);
      const tage = new Set(
        uc.map((c) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(c.date_created)))
      ).size;
      const stunden = nachStunde(uc);
      const fest = stunden.filter((h) => h.anrufe >= OPENER_STUNDE_MIN).sort((a, b) => quote(b) - quote(a));
      return {
        closeId: u.close_id,
        name: u.name,
        ...quoten(uc),
        aktiveTage: tage,
        anrufeProTag: tage > 0 ? uc.length / tage : null,
        termine: events.filter((e) => e.utm?._setter_user_id === u.close_id).length,
        stunden,
        wochentage: nachTag(uc),
        besteStunden: fest.slice(0, 3),
        schwaechsteStunde: fest.length > 3 ? fest[fest.length - 1] : null,
      };
    })
    .filter((o) => o.anrufe > 0)
    .sort((a, b) => b.anrufe - a.anrufe);

  return {
    minAnrufe: SLOT_MIN,
    gesamt: quoten(calls),
    slots,
    stunden: nachStunde(calls),
    wochentage: nachTag(calls),
    besteSlots: sortiert.slice(0, 5),
    schwaechsteSlots: sortiert.slice(-3).reverse(),
    buchungenProStunde: [...buch.entries()].sort((a, b) => a[0] - b[0]).map(([stunde, count]) => ({ stunde, count })),
    opener,
  };
}
