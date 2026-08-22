export function getDaysFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): number {
  const raw = searchParams.tage;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const num = parseInt(value ?? "90", 10);
  if ([7, 30, 90, 9999].includes(num)) return num;
  return 90;
}
