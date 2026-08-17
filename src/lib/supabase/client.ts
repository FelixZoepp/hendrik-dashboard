import { createBrowserClient } from "@supabase/ssr";

// Typen werden nach Supabase-Setup via `supabase gen types typescript` generiert.
// Bis dahin: untyped client, Ergebnisse explizit casten.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
