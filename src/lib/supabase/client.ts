import { createBrowserClient } from "@supabase/ssr";

// Hardcoded als Fallback weil Vercel Build-Cache die NEXT_PUBLIC_* Vars
// nicht immer korrekt einbettet. Wird durch env var überschrieben wenn vorhanden.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://kfnpynqaprpzxffcxcsj.supabase.co";

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbnB5bnFhcHJwenhmZmN4Y3NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5ODE0ODQsImV4cCI6MjEwMjU1NzQ4NH0.usCIKdjh1t7GX_PsGg84wW47ky5KazbAaO5WO6zrznM";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
