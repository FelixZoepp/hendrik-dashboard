// Sales-Controlling: reine Berechnungen auf den gesyncten Close-/Calendly-/Meta-Daten.
// Läuft serverseitig — an den Client gehen nur die fertigen Kennzahlen.

import { categorizeCancelReason } from "@/lib/sales-utils";

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

export interface ControllingInput {
  days: number;
  now: Date;
  periodStart: Date;
  prevStart: Date | null;
  users: CUser[];
  opps: COpp[]; // alle Opportunities
  calls: CCall[]; // Calls ab prevStart (bzw. periodStart)
  events: CEvent[]; // Calendly ab prevStart bis +60 Tage
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
  gebucht: number;
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

export interface Warnung {
  level: "rot" | "gelb";
  text: string;
}

export interface ControllingReport {
  periodLabel: string;
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
    showRateErst: Kpi;
    onboardings: Kpi;
  };
  funnel: FunnelStufe[];
  trend: TrendPunkt[];
  pipeline: { label: string; anzahl: number; wert: number }[];
  team: TeamZeile[];
  termine: TerminZeile[];
  absagegruende: { grund: string; anzahl: number }[];
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
  warnungen: Warnung[];
}

// ---------------------------------------------------------------------------
// Berechnung
// ---------------------------------------------------------------------------

export function buildReport(input: ControllingInput): ControllingReport {
  const { now, periodStart, prevStart, days } = input;
  const hasPrev = prevStart !== null;
  const prevEnd = periodStart;

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
  const meta = input.meta.filter((m) => inRange(`${m.date}T12:00:00Z`, periodStart, now));
  const metaPrev = hasPrev ? input.meta.filter((m) => inRange(`${m.date}T12:00:00Z`, prevStart!, prevEnd)) : [];

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
  const strategieShows = byTyp(events, "strategie").filter(isShow).length;
  const strategieShowsPrev = byTyp(eventsPrev, "strategie").filter(isShow).length;
  const erst = byTyp(events, "erst");
  const erstPrev = byTyp(eventsPrev, "erst");
  const erstVergangen = erst.filter((e) => e.status === "active");
  const erstVergangenPrev = erstPrev.filter((e) => e.status === "active");
  const pv = <T>(v: T) => (hasPrev ? v : null);

  const kpis: ControllingReport["kpis"] = {
    umsatz: { value: umsatz, prev: pv(umsatzPrev) },
    deals: { value: won.length, prev: pv(wonPrev.length) },
    avgDeal: { value: ratio(umsatz, won.length), prev: pv(ratio(umsatzPrev, wonPrev.length)) },
    pipelineWert: { value: sum(aktiv, (o) => o.value ?? 0), prev: null },
    pipelineAnzahl: aktiv.length,
    forecast: sum(aktiv, (o) => ((o.value ?? 0) * (o.confidence ?? 0)) / 100),
    closingRate: {
      value: ratio(won.length, strategieShows),
      prev: pv(ratio(wonPrev.length, strategieShowsPrev)),
    },
    adSpend: { value: adSpend, prev: pv(adSpendPrev) },
    cac: { value: ratio(adSpend, won.length), prev: pv(ratio(adSpendPrev, wonPrev.length)) },
    roas: { value: ratio(umsatz, adSpend), prev: pv(ratio(umsatzPrev, adSpendPrev)) },
    leads: { value: input.leadsNew, prev: input.leadsNewPrev },
    anrufe: { value: calls.length, prev: pv(callsPrev.length) },
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
    { key: "angerufen", label: "Leads angerufen", count: uniqueLeads(calls) },
    { key: "erreicht", label: "Leads erreicht", count: uniqueLeads(calls.filter(isReached)) },
    { key: "gespraech", label: "Leads mit Gespräch > 1 min", count: uniqueLeads(calls.filter(isConversation)) },
    { key: "erstGebucht", label: "Erstgespräch gebucht", count: erst.length },
    { key: "erstShow", label: "Erstgespräch stattgefunden", count: erst.filter(isShow).length },
    { key: "stratGebucht", label: "Strategie gebucht", count: byTyp(events, "strategie").length },
    { key: "stratShow", label: "Strategie stattgefunden", count: strategieShows },
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

  // --- Trend (Tage bei 7T, sonst Wochen) ---
  const bucketMs = days <= 14 ? 86400_000 : 7 * 86400_000;
  const spanStart = days >= 9999
    ? new Date(Math.min(...input.events.map((e) => new Date(e.scheduled_at).getTime()), now.getTime()))
    : periodStart;
  const nBuckets = Math.max(1, Math.ceil((now.getTime() - spanStart.getTime()) / bucketMs));
  const fmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
  const trend: TrendPunkt[] = Array.from({ length: Math.min(nBuckets, 60) }, (_, i) => {
    const from = new Date(now.getTime() - (Math.min(nBuckets, 60) - i) * bucketMs);
    const to = new Date(from.getTime() + bucketMs);
    const ev = input.events.filter((e) => inRange(e.scheduled_at, from, to) && isShow(e));
    const pf = new Date(from.getTime() - days * 86400_000);
    const pt = new Date(to.getTime() - days * 86400_000);
    return {
      label: fmt.format(from),
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
  const team: TeamZeile[] = input.users
    .map((u) => {
      const uc = calls.filter((c) => c.user_id === u.close_id);
      const reached = uc.filter(isReached);
      const talk = sum(uc, (c) => c.duration ?? 0);
      const gesetzt = events.filter((e) => e.utm?._setter_user_id === u.close_id);
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
        termineGesetzt: gesetzt.length,
        termineStattgefunden: gesetzt.filter(isShow).length,
        showRate: ratio(gesetzt.filter(isShow).length, gesetztVergangen.length),
        termineJe100: uc.length > 0 ? (gesetzt.length / uc.length) * 100 : null,
        strategieGeführt: geführt,
        deals: uw.length,
        umsatz: sum(uw, (o) => o.value ?? 0),
        closingRate: ratio(uw.length, geführt),
      };
    })
    .filter((t) => t.anrufe + t.termineGesetzt + t.strategieGeführt + t.deals > 0)
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
        gebucht: es.length,
        stattgefunden: es.filter(isShow).length,
        noShow: es.filter((e) => e.no_show).length,
        abgesagt: es.filter((e) => e.status === "canceled").length,
        offen: byTyp(kommendeEvents, typ).length,
        showRate: ratio(vergangen.filter(isShow).length, vergangen.length),
        avgVorlaufTage: vorlauf.length > 0 ? sum(vorlauf, (d) => d) / vorlauf.length : null,
      };
    })
    .filter((t) => t.gebucht + t.offen > 0);

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

  return {
    periodLabel: days >= 9999 ? "Gesamter Zeitraum" : `Letzte ${days} Tage`,
    hasPrev,
    kpis,
    funnel,
    trend,
    pipeline,
    team,
    termine,
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
