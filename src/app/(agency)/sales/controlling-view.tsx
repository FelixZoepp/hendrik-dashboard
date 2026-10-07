"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CircleAlert,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatEuro, formatSeconds, TAGE_KURZ } from "@/lib/sales-utils";
import type { ControllingReport, Kpi } from "@/lib/controlling";
import { ErreichbarkeitView } from "./erreichbarkeit-view";

// Zwei-Serien-Palette (validiert: CVD ΔE 30.5, normal ΔE 34.9)
const SERIE_ERST = "#1f5fbf";
const SERIE_STRAT = "#c98a1c";

const num = (v: number | null, digits = 0) =>
  v == null ? "—" : v.toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`);
const euro = (v: number | null) => (v == null ? "—" : formatEuro(v));

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function Delta({ kpi, invert = false }: { kpi: Kpi; invert?: boolean }) {
  if (kpi.prev == null || kpi.value == null) return null;
  if (kpi.prev === 0) {
    return kpi.value === 0 ? null : <span className="text-xs text-muted-foreground">neu</span>;
  }
  const d = (kpi.value - kpi.prev) / Math.abs(kpi.prev);
  const good = invert ? d < 0 : d > 0;
  const Icon = d >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-sm font-medium", good ? "text-success" : "text-sla-rot")}>
      <Icon className="size-3.5" />
      {Math.abs(d * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %
    </span>
  );
}

function KpiCard({
  label,
  value,
  kpi,
  hint,
  hero = false,
  invert = false,
}: {
  label: string;
  value: string;
  kpi?: Kpi;
  hint?: string;
  hero?: boolean;
  invert?: boolean;
}) {
  return (
    <div className={cn("flex flex-col justify-between p-6", hero ? "fern-hero" : "fern-card")}>
      <p className={cn("text-[15px]", hero ? "text-white/80" : "text-foreground")}>{label}</p>
      <p className="mt-4 text-4xl font-semibold tracking-tight">{value}</p>
      <div className={cn("mt-3 flex min-h-5 items-center gap-1.5 text-sm", hero ? "text-white/70" : "text-muted-foreground")}>
        {kpi && (hero ? <HeroDelta kpi={kpi} /> : <Delta kpi={kpi} invert={invert} />)}
        <span>{hint ?? (kpi?.prev != null ? "vs. Vorperiode" : "")}</span>
      </div>
    </div>
  );
}

function HeroDelta({ kpi }: { kpi: Kpi }) {
  if (kpi.prev == null || kpi.value == null || kpi.prev === 0) return null;
  const d = (kpi.value - kpi.prev) / Math.abs(kpi.prev);
  return (
    <span className="rounded-md border border-white/30 px-1.5 py-0.5 text-xs font-medium text-white">
      {d >= 0 ? "+" : "−"}
      {Math.abs(d * 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} %
    </span>
  );
}

function Section({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("fern-card p-6", className)}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows, align }: { head: string[]; rows: React.ReactNode[][]; align?: ("l" | "r")[] }) {
  return (
    <div className="-mx-6 overflow-x-auto px-6">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border">
            {head.map((h, i) => (
              <th
                key={h}
                className={cn(
                  "whitespace-nowrap px-3 pb-3 text-xs font-medium text-muted-foreground first:pl-0",
                  (align?.[i] ?? (i === 0 ? "l" : "r")) === "l" ? "text-left" : "text-right"
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, ri) => (
            <tr key={ri} className="transition-colors hover:bg-muted/50">
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "whitespace-nowrap px-3 py-3 first:pl-0",
                    (align?.[ci] ?? (ci === 0 ? "l" : "r")) === "l" ? "text-left" : "text-right"
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl bg-muted/60 px-4 py-8 text-center text-sm text-muted-foreground">{text}</p>;
}

function Heatmap({ data, label }: { data: { tag: number; stunde: number; count: number }[]; label: string }) {
  const map = new Map(data.map((d) => [`${d.tag}-${d.stunde}`, d.count]));
  const max = Math.max(1, ...data.map((d) => d.count));
  const stunden = Array.from({ length: 13 }, (_, i) => i + 8);
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium">{label}</h3>
      <div className="overflow-x-auto">
        <div className="grid min-w-[520px] gap-1" style={{ gridTemplateColumns: `2rem repeat(${stunden.length}, 1fr)` }}>
          <div />
          {stunden.map((h) => (
            <div key={h} className="pb-1 text-center text-[10px] text-muted-foreground">
              {h}
            </div>
          ))}
          {TAGE_KURZ.map((tag, ti) => (
            <div key={tag} className="contents">
              <div className="flex items-center text-[11px] text-muted-foreground">{tag}</div>
              {stunden.map((h) => {
                const v = map.get(`${ti}-${h}`) ?? 0;
                return (
                  <div
                    key={h}
                    title={`${tag} ${h}:00 — ${v}`}
                    className="aspect-square rounded-md"
                    style={{
                      backgroundColor: v === 0 ? "var(--muted)" : `color-mix(in oklch, ${SERIE_ERST} ${Math.round(18 + (v / max) * 82)}%, var(--card))`,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ansicht
// ---------------------------------------------------------------------------

export function ControllingView({ report: r }: { report: ControllingReport }) {
  const k = r.kpis;
  const maxFunnel = Math.max(1, ...r.funnel.map((f) => f.count));
  const maxPipe = Math.max(1, ...r.pipeline.map((p) => p.anzahl));
  const maxGrund = Math.max(1, ...r.absagegruende.map((g) => g.anzahl));
  const dt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

  return (
    <div className="space-y-6">
      {r.warnungen.length > 0 && (
        <div className="space-y-2">
          {r.warnungen.map((w) => (
            <div
              key={w.text}
              className={cn(
                "flex items-start gap-3 rounded-2xl px-4 py-3 text-sm",
                w.level === "rot" ? "bg-sla-rot/10 text-sla-rot" : "bg-warning/15 text-[#7a5410]"
              )}
            >
              {w.level === "rot" ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
              <span>{w.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Kern-KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard hero label="Umsatz (gewonnen)" value={euro(k.umsatz.value)} kpi={k.umsatz} hint={`${num(k.deals.value)} Deals · Ø ${euro(k.avgDeal.value)}`} />
        {(k.pipelineWert.value ?? 0) > 0 ? (
          <KpiCard label="Offene Pipeline" value={euro(k.pipelineWert.value)} hint={`${num(k.pipelineAnzahl)} Opportunities · Forecast ${euro(k.forecast)}`} />
        ) : (
          <KpiCard label="Offene Opportunities" value={num(k.pipelineAnzahl)} hint="ohne Deal-Wert in Close gepflegt" />
        )}
        <KpiCard label="Closing-Rate" value={pct(k.closingRate.value)} kpi={k.closingRate} hint="Deals / stattgef. Strategiegespräche" />
        <KpiCard label="ROAS" value={k.roas.value == null ? "—" : `${num(k.roas.value, 2)}x`} kpi={k.roas} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Ad Spend" value={euro(k.adSpend.value)} kpi={k.adSpend} invert />
        <KpiCard label="CAC" value={euro(k.cac.value)} kpi={k.cac} invert hint="Ad Spend / gewonnene Deals" />
        <KpiCard label="Neue Leads" value={num(k.leads.value)} kpi={k.leads} />
        <KpiCard label="Show-Rate Erstgespräch" value={pct(k.showRateErst.value)} kpi={k.showRateErst} />
      </div>

      {/* Funnel + Kommende Termine */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Section
          className="xl:col-span-2"
          title="Funnel"
          subtitle="Vom Anruf bis zum Abschluss: eindeutige Leads bzw. Termine, Conversion zur Vorstufe und Ad Spend je Stufe"
        >
          <div className="space-y-3">
            {r.funnel.map((f) => (
              <div key={f.key} className="grid grid-cols-[minmax(8rem,12rem)_4.5rem_1fr_auto] items-center gap-4">
                <span className="truncate text-sm" title={f.hint}>
                  {f.label}
                </span>
                <span className="text-right text-base font-semibold tabular-nums">{num(f.count)}</span>
                <div className="h-3 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full fern-btn-primary"
                    style={{ width: `${f.count === 0 ? 0 : Math.max(2, (f.count / maxFunnel) * 100)}%` }}
                  />
                </div>
                <div className="w-36 text-right text-xs text-muted-foreground">
                  {f.rateVorher != null && <span className="font-medium text-foreground">{pct(f.rateVorher)}</span>}
                  {f.kostenJe != null && f.count > 0 && <span className="ml-2">{euro(f.kostenJe)}/Stk.</span>}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Kommende Termine" subtitle="Bereits gebucht, nächste 60 Tage">
          {r.kommend.length === 0 ? (
            <Empty text="Keine kommenden Termine gesynct." />
          ) : (
            <ul className="space-y-3">
              {r.kommend.map((t) => (
                <li key={t.start + t.name} className="flex items-center gap-4">
                  <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-accent py-1.5 text-primary">
                    <span className="text-[10px] font-medium uppercase">
                      {new Date(t.start).toLocaleDateString("de-DE", { month: "short", timeZone: "Europe/Berlin" })}
                    </span>
                    <span className="text-lg font-semibold leading-none">
                      {new Date(t.start).toLocaleDateString("de-DE", { day: "numeric", timeZone: "Europe/Berlin" })}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.typ} · {dt.format(new Date(t.start))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Trend + Pipeline */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Section
          className="xl:col-span-2"
          title="Entwicklung"
          subtitle={`Stattgefundene Gespräche ${r.trendEinheit}`}
          action={
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded" style={{ background: SERIE_ERST }} /> Erstgespräche
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded" style={{ background: SERIE_STRAT }} /> Strategie
              </span>
              {r.hasPrev && (
                <span className="flex items-center gap-1.5">
                  <span className="w-4 border-t-2 border-dashed border-muted-foreground" /> Erst. Vorperiode
                </span>
              )}
            </div>
          }
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={r.trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillErst" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIE_ERST} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={SERIE_ERST} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} minTickGap={24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                <Tooltip
                  cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                  contentStyle={{ borderRadius: 16, border: "none", boxShadow: "0 8px 24px -12px rgb(0 0 0 / 0.2)", fontSize: 13 }}
                  formatter={(v, name) => [num(Number(v)), name]}
                />
                <Area type="monotone" dataKey="erst" name="Erstgespräche" stroke={SERIE_ERST} strokeWidth={2} fill="url(#fillErst)" />
                <Area type="monotone" dataKey="strategie" name="Strategie" stroke={SERIE_STRAT} strokeWidth={2} fill="transparent" />
                {r.hasPrev && (
                  <Line type="monotone" dataKey="vorperiodeErst" name="Erst. Vorperiode" stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Pipeline" subtitle={`${num(k.pipelineAnzahl)} offene Opportunities nach Status`}>
          {r.pipeline.length === 0 ? (
            <Empty text="Keine offenen Opportunities." />
          ) : (
            <ul className="space-y-4">
              {r.pipeline.map((p) => (
                <li key={p.label}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{p.label}</span>
                    <span className="shrink-0 font-medium">
                      {num(p.anzahl)}
                      {p.wert > 0 && <span className="font-normal text-muted-foreground"> · {euro(p.wert)}</span>}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${(p.anzahl / maxPipe) * 100}%`, background: SERIE_ERST }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Detail-Tabs */}
      <Tabs defaultValue="team">
        <TabsList>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="erreichbarkeit">Erreichbarkeit</TabsTrigger>
          <TabsTrigger value="termine">Termine</TabsTrigger>
          <TabsTrigger value="aktivitaet">Aktivität</TabsTrigger>
          <TabsTrigger value="marketing">Kampagnen</TabsTrigger>
          <TabsTrigger value="daten">Datenqualität</TabsTrigger>
        </TabsList>

        <TabsContent value="team" className="mt-4">
          <Section
            title="Team-Leistung"
            subtitle="Setter: Termin wird dem letzten Anrufer auf dem Lead vor der Buchung zugeordnet. Closer: Host des Strategiegesprächs bzw. Owner der Opportunity."
          >
            {r.team.length === 0 ? (
              <Empty text="Keine Team-Aktivität im Zeitraum." />
            ) : (
              <Table
                head={["Name", "Anrufe", "Erreicht", "Quote", "Gespräche > 1 min", "Ø Gespräch", "Gesprächszeit", "Termine gesetzt", "davon Show", "Show-Rate", "Termine/100 Calls", "Strategie geführt", "Deals", "Umsatz", "Closing-Rate"]}
                rows={r.team.map((t) => [
                  <span key="n" className="font-medium">{t.name}</span>,
                  num(t.anrufe),
                  num(t.erreicht),
                  pct(t.erreichtQuote),
                  num(t.gespraeche),
                  t.avgDauer == null ? "—" : formatSeconds(t.avgDauer),
                  formatSeconds(t.gespraechszeit),
                  num(t.termineGesetzt),
                  num(t.termineStattgefunden),
                  pct(t.showRate),
                  t.termineJe100 == null ? "—" : num(t.termineJe100, 1),
                  num(t.strategieGeführt),
                  num(t.deals),
                  euro(t.umsatz),
                  pct(t.closingRate),
                ])}
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="erreichbarkeit" className="mt-4">
          <ErreichbarkeitView data={r.erreichbarkeit} />
        </TabsContent>

        <TabsContent value="termine" className="mt-4 space-y-4">
          <Section title="Termine nach Typ" subtitle="Show-Rate = stattgefunden / nicht abgesagte, vergangene Termine">
            {r.termine.length === 0 ? (
              <Empty text="Keine Termine im Zeitraum." />
            ) : (
              <Table
                head={["Typ", "Gebucht", "Stattgefunden", "No-Show", "Abgesagt", "Show-Rate", "Ø Vorlauf", "Kommend"]}
                rows={r.termine.map((t) => [
                  <span key="l" className="font-medium">{t.label}</span>,
                  num(t.gebucht),
                  num(t.stattgefunden),
                  num(t.noShow),
                  num(t.abgesagt),
                  pct(t.showRate),
                  t.avgVorlaufTage == null ? "—" : `${num(t.avgVorlaufTage, 1)} Tage`,
                  num(t.offen),
                ])}
              />
            )}
          </Section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Absagegründe">
              {r.absagegruende.length === 0 ? (
                <Empty text="Keine Absagen im Zeitraum." />
              ) : (
                <ul className="space-y-3">
                  {r.absagegruende.map((g) => (
                    <li key={g.grund} className="grid grid-cols-[10rem_1fr_2.5rem] items-center gap-3 text-sm">
                      <span className="truncate">{g.grund}</span>
                      <div className="h-2 rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${(g.anzahl / maxGrund) * 100}%`, background: SERIE_STRAT }} />
                      </div>
                      <span className="text-right font-medium">{g.anzahl}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Abgesagte Termine nach Buchungsvorlauf" subtitle="Zeit zwischen Buchung und Termin">
              <div className="grid grid-cols-3 gap-3">
                {[
                  ["> 24 h", r.absagenVorlauf.ueber24h],
                  ["2–24 h", r.absagenVorlauf.unter24h],
                  ["< 2 h", r.absagenVorlauf.unter2h],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-2xl bg-muted/60 p-4">
                    <p className="text-sm text-muted-foreground">{l}</p>
                    <p className="mt-1 text-3xl font-semibold tracking-tight">{v}</p>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="aktivitaet" className="mt-4">
          <Section title="Wann wird telefoniert, wann finden Termine statt?" subtitle="Wochentag × Uhrzeit, Europe/Berlin">
            <div className="grid gap-8 lg:grid-cols-2">
              <Heatmap data={r.heatmapAnrufe} label={`Anrufe (${num(k.anrufe.value)})`} />
              <Heatmap data={r.heatmapShows} label="Stattgefundene Termine" />
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="marketing" className="mt-4">
          <Section title="Meta-Kampagnen" subtitle="Spend und Leads laut Meta im Zeitraum">
            {r.kampagnen.length === 0 ? (
              <Empty text="Keine Meta-Daten im Zeitraum." />
            ) : (
              <Table
                head={["Kampagne", "Spend", "Klicks", "Leads", "CPL"]}
                rows={r.kampagnen.map((c) => [
                  <span key="n" className="font-medium">{c.name}</span>,
                  euro(c.spend),
                  num(c.clicks),
                  num(c.leads),
                  euro(c.cpl),
                ])}
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="daten" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Sync-Status" action={<CalendarClock className="size-5 text-muted-foreground" />}>
              <Table
                head={["Quelle", "Zuletzt", "Status", "Datensätze"]}
                rows={r.datenstand.syncs.map((s) => [
                  <span key="s" className="font-medium capitalize">{s.source}</span>,
                  s.zuletzt ? dt.format(new Date(s.zuletzt)) : "—",
                  <span
                    key="st"
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium",
                      s.status === "success" ? "bg-accent text-primary" : s.status === "error" ? "bg-sla-rot/10 text-sla-rot" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {s.status === "success" ? "OK" : s.status}
                  </span>,
                  num(s.records),
                ])}
              />
              <p className="mt-4 text-xs text-muted-foreground">
                Meta-Daten bis: {r.datenstand.metaLetzterTag ? new Date(r.datenstand.metaLetzterTag).toLocaleDateString("de-DE") : "—"} · Termine mit
                Setter-Zuordnung: {num(r.datenstand.setterZugeordnet)} von {num(r.datenstand.termineMitEmail)} mit E-Mail
              </p>
            </Section>
            <Section title="Abgleich mit Close" subtitle="Live-Zählung über die Close-API vs. Datenbank" action={<Database className="size-5 text-muted-foreground" />}>
              <Table
                head={["Objekt", "Dashboard", "Close live", ""]}
                rows={r.datenstand.totals.map((t) => {
                  const ok = t.close == null || t.db == null ? null : t.close === t.db;
                  return [
                    <span key="l" className="font-medium">{t.label}</span>,
                    num(t.db),
                    num(t.close),
                    ok == null ? "" : ok ? <span key="ok" className="text-success">✓</span> : <span key="no" className="text-sla-rot">Abweichung</span>,
                  ];
                })}
              />
            </Section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
