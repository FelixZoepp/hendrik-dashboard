const PAGE_SIZE = 1000;
const PARALLEL = 6;

interface RangeableQuery {
  range(
    from: number,
    to: number
  ): PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
    count?: number | null;
  }>;
}

/**
 * Supabase/PostgREST liefert pro Request max. 1000 Zeilen.
 * Lädt alle Seiten — bei `select(..., { count: "exact" })` parallel, sonst nacheinander.
 * `build` muss bei jedem Aufruf eine frische Query mit stabiler Sortierung liefern.
 */
export async function fetchAll<T>(build: () => RangeableQuery): Promise<T[]> {
  const first = await build().range(0, PAGE_SIZE - 1);
  if (first.error) throw new Error(first.error.message);
  const rows = [...((first.data ?? []) as T[])];
  if (rows.length < PAGE_SIZE) return rows;

  if (typeof first.count === "number") {
    const offsets: number[] = [];
    for (let from = PAGE_SIZE; from < first.count; from += PAGE_SIZE) offsets.push(from);
    for (let i = 0; i < offsets.length; i += PARALLEL) {
      const pages = await Promise.all(
        offsets.slice(i, i + PARALLEL).map((from) => build().range(from, from + PAGE_SIZE - 1))
      );
      for (const page of pages) {
        if (page.error) throw new Error(page.error.message);
        rows.push(...((page.data ?? []) as T[]));
      }
    }
    return rows;
  }

  for (let from = PAGE_SIZE; ; from += PAGE_SIZE) {
    const page = await build().range(from, from + PAGE_SIZE - 1);
    if (page.error) throw new Error(page.error.message);
    rows.push(...((page.data ?? []) as T[]));
    if (!page.data || page.data.length < PAGE_SIZE) break;
  }
  return rows;
}
