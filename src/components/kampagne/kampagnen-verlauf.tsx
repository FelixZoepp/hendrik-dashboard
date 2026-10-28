"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WochenPunkt } from "@/lib/kampagne/logik";

const euro0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function Diagramm({
  daten,
  feld,
  titel,
  farbe,
  format,
}: {
  daten: WochenPunkt[];
  feld: "leads" | "ausgaben";
  titel: string;
  farbe: string;
  format: (v: number) => string;
}) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm font-medium">{titel}</figcaption>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={daten} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              minTickGap={12}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={feld === "ausgaben" ? 56 : 28}
              tickFormatter={(v: number) => (feld === "ausgaben" ? euro0.format(v) : String(v))}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              formatter={(v) => [format(Number(v)), titel]}
              labelFormatter={(l) => `Woche ${String(l)}`}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--foreground)",
                fontSize: 13,
              }}
            />
            <Bar dataKey={feld} fill={farbe} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Verlauf je Woche: zwei getrennte Diagramme (keine zweite y-Achse). */
export function KampagnenVerlauf({ daten }: { daten: WochenPunkt[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Diagramm daten={daten} feld="leads" titel="Anfragen je Woche" farbe="var(--chart-2)" format={(v) => String(v)} />
      <Diagramm
        daten={daten}
        feld="ausgaben"
        titel="Werbebudget je Woche"
        farbe="var(--chart-1)"
        format={(v) => euro0.format(v)}
      />
    </div>
  );
}
