import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://kfnpynqaprpzxffcxcsj.supabase.co";

const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbnB5bnFhcHJwenhmZmN4Y3NqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Njk4MTQ4NCwiZXhwIjoyMTAyNTU3NDg0fQ.HlXxPGyATojcM-rsmbB_TPQWvI1j0R6TpwsiEmd2gP0";

export function createAdminClient() {
  return createSupabaseClient(URL, KEY);
}
