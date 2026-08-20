export function getDaysFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): number {
  const raw = searchParams.tage;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const num = parseInt(value ?? "90", 10);
  return [7, 30, 90].includes(num) ? num : 90;
}
