export function getDaysFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): number {
  const raw = searchParams.tage;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const num = parseInt(value ?? "90", 10);
  if ([7, 30, 90, 9999].includes(num)) return num;
  return 90;
}

// ---------------------------------------------------------------------------
// Kalender-Zeiträume in Europe/Berlin
// ---------------------------------------------------------------------------

const TZ = "Europe/Berlin";

/** Datumsteile (Jahr/Monat/Tag) eines Zeitpunkts in Berlin. */
function berlinYmd(d: Date): { y: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d)
    .split("-")
    .map(Number);
  return { y: p[0], m: p[1], d: p[2] };
}

/** 00:00 Uhr Berliner Zeit am angegebenen Kalendertag (berücksichtigt Sommer-/Winterzeit). */
export function berlinMidnight(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const hourInBerlin = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(guess))
  );
  // Berlin ist UTC+1 oder UTC+2 → 00:00 UTC entspricht 01:00 bzw. 02:00 Berlin
  return new Date(guess - hourInBerlin * 3600_000);
}

/** Kalendertag in Berlin um `n` Tage verschoben, als Berliner Mitternacht. */
export function berlinDayStart(base: Date, offsetDays = 0): Date {
  const { y, m, d } = berlinYmd(base);
  const shifted = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return berlinMidnight(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** YYYY-MM-DD in Berlin (für date-Spalten wie meta_ad_insights.date). */
export function berlinDateString(d: Date): string {
  const { y, m, d: day } = berlinYmd(d);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface Period {
  days: number;
  allTime: boolean;
  /** Beginn: 00:00 Berlin, (days-1) Tage vor heute — heute zählt als voller Tag mit */
  start: Date;
  /** Ende: Jetzt (Daten bis zum aktuellen Zeitpunkt) */
  end: Date;
  /** Vorperiode: gleich viele Kalendertage direkt davor, bis zur gleichen relativen Uhrzeit */
  prevStart: Date | null;
  prevEnd: Date | null;
  label: string;
  rangeLabel: string;
  prevRangeLabel: string | null;
}

const fmtDay = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

export function getPeriod(days: number, now = new Date()): Period {
  const allTime = days >= 9999;
  const start = allTime ? new Date("2000-01-01T00:00:00Z") : berlinDayStart(now, -(days - 1));
  const prevStart = allTime ? null : berlinDayStart(now, -(2 * days - 1));
  // Gleich lange Vorperiode bis zur gleichen relativen Uhrzeit (fairer Vergleich, wenn heute erst halb vorbei ist)
  const prevEnd = prevStart ? new Date(prevStart.getTime() + (now.getTime() - start.getTime())) : null;
  const lastDayOf = (d: Date) => new Date(d.getTime() - 1);
  return {
    days,
    allTime,
    start,
    end: now,
    prevStart,
    prevEnd,
    label: allTime ? "Gesamter Zeitraum" : days === 7 ? "Letzte 7 Tage" : `Letzte ${days} Tage`,
    rangeLabel: allTime ? "alle Daten" : `${fmtDay.format(start)} – ${fmtDay.format(now)}`,
    prevRangeLabel:
      prevStart && prevEnd ? `${fmtDay.format(prevStart)} – ${fmtDay.format(lastDayOf(prevEnd))}` : null,
  };
}
