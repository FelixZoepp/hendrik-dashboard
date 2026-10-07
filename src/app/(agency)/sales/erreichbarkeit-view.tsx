"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock, PhoneCall, PhoneIncoming, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { TAGE_KURZ } from "@/lib/sales-utils";
import type { Erreichbarkeit, Quoten } from "@/lib/controlling";

// gleiche validierte Zwei-Serien-Palette wie im Controlling
const BLAU = "#1f5fbf";
const AMBER = "#c98a1c";
const STUNDEN = Array.from({ length: 14 }, (_, i) => i + 7); // 7–20 Uhr

const rate = (q: Quoten) => (q.anrufe > 0 ? q.erreicht / q.anrufe : null);
const gRate = (q: Quoten) => (q.anrufe > 0 ? q.gespraeche / q.anrufe : null);
const pct = (v: number | null) =>
  v == null ? "—" : `${(v * 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} %`;
const num = (v: number | null, d = 0) =>
  v == null ? "—" : v.toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });
const slotLabel = (stunde: number) => `${stunde}–${stunde + 1} Uhr`;

/** Sequenzielle Blau-Skala: gleiche Farbe, Deckkraft nach Quote relativ zum Maximum. */
function cellColor(v: number | null, max: number) {
  if (v == null) return "var(--muted)";
  const t = max > 0 ? v / max : 0;
  return `color-mix(in oklch, ${BLAU} ${Math.round(12 + t * 88)}%, var(--card))`;
}

function Card({ title, subtitle, children, className }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("fern-card p-6", className)}>
      <h2 className="text-xl font-medium tracking-tight">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Clock; label: string; value: string; hint?: string }) {
  return (
    <div className="fern-card p-6">
      <div className="flex items-center gap-2 text-[15px]">
        <Icon className="size-4 text-primary" />
        {label}
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-2 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ErreichbarkeitView({ data: e }: { data: Erreichbarkeit }) {
  if (e.gesamt.anrufe === 0) {
    return <p className="fern-card p-8 text-center text-sm text-muted-foreground">Keine Anrufe im Zeitraum.</p>;
  }

  const slotMap = new Map(e.slots.map((s) => [`${s.tag}-${s.stunde}`, s]));
  const maxSlot = Math.max(0, ...e.slots.filter((s) => s.anrufe >= e.minAnrufe).map((s) => rate(s) ?? 0));
  const beste = e.besteSlots[0];
  const chartData = STUNDEN.map((h) => {
    const q = e.stunden.find((s) => s.stunde === h);
    return {
      stunde: `${h}`,
      erreicht: q && q.anrufe >= e.minAnrufe ? (rate(q) ?? 0) * 100 : null,
      gespraech: q && q.anrufe >= e.minAnrufe ? (gRate(q) ?? 0) * 100 : null,
      anrufe: q?.anrufe ?? 0,
    };
  });
  const maxBuchung = Math.max(1, ...e.buchungenProStunde.map((b) => b.count));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={PhoneCall} label="Anrufe" value={num(e.gesamt.anrufe)} hint={`${num(e.opener.length)} Opener aktiv`} />
        <Stat icon={PhoneIncoming} label="Erreichquote" value={pct(rate(e.gesamt))} hint={`${num(e.gesamt.erreicht)} abgenommen`} />
        <Stat icon={Clock} label="Gesprächsquote" value={pct(gRate(e.gesamt))} hint={`${num(e.gesamt.gespraeche)} Gespräche > 1 min`} />
        <Stat
          icon={Sparkles}
          label="Beste Zeit"
          value={beste ? `${TAGE_KURZ[beste.tag]} ${slotLabel(beste.stunde)}` : "—"}
          hint={beste ? `${pct(rate(beste))} erreicht bei ${num(beste.anrufe)} Anrufen` : `zu wenig Anrufe (min. ${e.minAnrufe} je Zeitfenster)`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Erreichquote nach Wochentag × Uhrzeit"
          subtitle={`Anteil abgenommener Anrufe, Europe/Berlin. Grau = weniger als ${e.minAnrufe} Anrufe, nicht belastbar.`}
        >
          <div className="overflow-x-auto">
            <div className="grid min-w-[560px] gap-1" style={{ gridTemplateColumns: `2rem repeat(${STUNDEN.length}, 1fr)` }}>
              <div />
              {STUNDEN.map((h) => (
                <div key={h} className="pb-1 text-center text-[11px] text-muted-foreground">
                  {h}
                </div>
              ))}
              {TAGE_KURZ.map((tag, ti) => (
                <div key={tag} className="contents">
                  <div className="flex items-center text-xs text-muted-foreground">{tag}</div>
                  {STUNDEN.map((h) => {
                    const s = slotMap.get(`${ti}-${h}`);
                    const ok = s && s.anrufe >= e.minAnrufe;
                    const v = ok ? rate(s) : null;
                    return (
                      <div
                        key={h}
                        title={s ? `${tag} ${slotLabel(h)}: ${pct(rate(s))} erreicht · ${num(s.anrufe)} Anrufe · ${num(s.gespraeche)} Gespräche` : `${tag} ${slotLabel(h)}: keine Anrufe`}
                        className="flex aspect-[4/3] items-center justify-center rounded-md text-[10px] font-medium"
                        style={{ backgroundColor: cellColor(v, maxSlot), color: v != null && maxSlot > 0 && v / maxSlot > 0.55 ? "white" : "var(--muted-foreground)" }}
                      >
                        {v != null ? Math.round(v * 100) : ""}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <span>0 %</span>
            <span className="h-2 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${cellColor(0, 1)}, ${BLAU})` }} />
            <span>{pct(maxSlot)}</span>
            <span className="ml-3">Zahl in der Zelle = Erreichquote in %</span>
          </div>
        </Card>

        <Card title="Beste Zeitfenster" subtitle={`Höchste Erreichquote, min. ${e.minAnrufe} Anrufe`}>
          {e.besteSlots.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch zu wenig Anrufe je Zeitfenster.</p>
          ) : (
            <ol className="space-y-3">
              {e.besteSlots.map((s, i) => (
                <li key={`${s.tag}-${s.stunde}`} className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-primary">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {TAGE_KURZ[s.tag]} · {slotLabel(s.stunde)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {num(s.anrufe)} Anrufe · Gesprächsquote {pct(gRate(s))}
                    </span>
                  </span>
                  <span className="text-lg font-semibold">{pct(rate(s))}</span>
                </li>
              ))}
            </ol>
          )}
          {e.schwaechsteSlots.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Am schlechtesten</p>
              <ul className="space-y-1.5 text-sm">
                {e.schwaechsteSlots.map((s) => (
                  <li key={`w-${s.tag}-${s.stunde}`} className="flex justify-between">
                    <span>
                      {TAGE_KURZ[s.tag]} · {slotLabel(s.stunde)}
                    </span>
                    <span className="font-medium">{pct(rate(s))}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Quoten nach Uhrzeit"
          subtitle="Erreicht = abgenommen; Gespräch = abgenommen und länger als 1 Minute. Alle Wochentage zusammen."
        >
          <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: BLAU }} /> Erreichquote
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: AMBER }} /> Gesprächsquote
            </span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="stunde" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickFormatter={(h) => `${h} h`} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${v} %`} />
                <Tooltip
                  cursor={{ fill: "var(--muted)" }}
                  contentStyle={{ borderRadius: 16, border: "none", boxShadow: "0 8px 24px -12px rgb(0 0 0 / 0.2)", fontSize: 13 }}
                  labelFormatter={(h, p) => `${h}–${Number(h) + 1} Uhr · ${num(p?.[0]?.payload?.anrufe ?? 0)} Anrufe`}
                  formatter={(v, name) => [`${num(Number(v))} %`, name]}
                />
                <Bar dataKey="erreicht" name="Erreichquote" fill={BLAU} radius={[4, 4, 0, 0]} />
                <Bar dataKey="gespraech" name="Gesprächsquote" fill={AMBER} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Erreichquote nach Wochentag">
          <ul className="space-y-3">
            {e.wochentage.map((w) => (
              <li key={w.tag} className="grid grid-cols-[2rem_1fr_3rem] items-center gap-3 text-sm">
                <span className="text-muted-foreground">{TAGE_KURZ[w.tag]}</span>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${w.anrufe >= e.minAnrufe ? (rate(w) ?? 0) * 100 : 0}%`, background: BLAU }} />
                </div>
                <span className="text-right font-medium" title={`${num(w.anrufe)} Anrufe`}>
                  {w.anrufe >= e.minAnrufe ? pct(rate(w)) : "—"}
                </span>
              </li>
            ))}
          </ul>
          {e.buchungenProStunde.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
              <p className="mb-3 text-sm font-medium">Wann werden Termine gesetzt?</p>
              <div className="flex h-20 items-end gap-1">
                {STUNDEN.map((h) => {
                  const c = e.buchungenProStunde.find((b) => b.stunde === h)?.count ?? 0;
                  return (
                    <div key={h} className="flex flex-1 flex-col items-center gap-1" title={`${slotLabel(h)}: ${c} Termine gebucht`}>
                      <div className="w-full rounded-t" style={{ height: `${(c / maxBuchung) * 64}px`, background: BLAU, minHeight: c ? 2 : 0 }} />
                      <span className="text-[10px] text-muted-foreground">{h}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Erreichbarkeit je Opener"
        subtitle="Erreichquote je Stunde (Europe/Berlin). Beste Stunden nur mit mindestens 15 Anrufen."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {e.opener.map((o) => {
            const maxO = Math.max(0, ...o.stunden.filter((h) => h.anrufe >= 15).map((h) => rate(h) ?? 0));
            return (
              <div key={o.closeId} className="rounded-2xl bg-muted/50 p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-lg font-medium">{o.name}</h3>
                  <span className="text-sm text-muted-foreground">
                    {num(o.aktiveTage)} Tage aktiv · Ø {num(o.anrufeProTag)} Anrufe/Tag
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-3">
                  {[
                    ["Anrufe", num(o.anrufe)],
                    ["Erreicht", pct(rate(o))],
                    ["Gespräche", pct(gRate(o))],
                    ["Termine", num(o.termine)],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <p className="text-xs text-muted-foreground">{l}</p>
                      <p className="text-xl font-semibold tracking-tight">{v}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-1" style={{ gridTemplateColumns: `repeat(${STUNDEN.length}, 1fr)` }}>
                  {STUNDEN.map((h) => {
                    const q = o.stunden.find((s) => s.stunde === h);
                    const ok = q && q.anrufe >= 15;
                    const v = ok ? rate(q) : null;
                    return (
                      <div key={h} className="flex flex-col items-center gap-1">
                        <div
                          className="h-8 w-full rounded-md"
                          style={{ backgroundColor: cellColor(v, maxO) }}
                          title={q ? `${slotLabel(h)}: ${pct(rate(q))} erreicht · ${num(q.anrufe)} Anrufe` : `${slotLabel(h)}: keine Anrufe`}
                        />
                        <span className="text-[10px] text-muted-foreground">{h}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                  {o.besteStunden.length === 0 ? (
                    <span className="text-muted-foreground">Zu wenig Anrufe für eine Empfehlung.</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">Beste Zeiten:</span>
                      {o.besteStunden.map((b) => (
                        <span key={b.stunde} className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-primary">
                          {slotLabel(b.stunde)} · {pct(rate(b))}
                        </span>
                      ))}
                      {o.schwaechsteStunde && (
                        <span className="rounded-full bg-sla-rot/10 px-2.5 py-1 text-xs font-medium text-sla-rot">
                          schwächste: {slotLabel(o.schwaechsteStunde.stunde)} · {pct(rate(o.schwaechsteStunde))}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
