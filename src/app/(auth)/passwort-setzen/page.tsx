import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PasswortForm } from "./passwort-form";

export const metadata: Metadata = {
  title: "Passwort festlegen",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Link aus „Zugang anlegen“: /passwort-setzen?token_hash=…&type=invite|recovery
// Der Token wird erst beim Absenden eingelöst — Link-Vorschauen (WhatsApp, Mail) verbrauchen ihn nicht.
export default async function PasswortSetzenPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash, type } = await searchParams;
  const typ = type === "recovery" ? "recovery" : "invite";

  let angemeldet = false;
  if (!token_hash) {
    const supabase = await createClient();
    angemeldet = !!(await supabase.auth.getUser()).data.user;
  }

  if (!token_hash && !angemeldet) {
    return (
      <div className="fern-card p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">Link fehlt</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Öffne bitte den Link, den du von Hoffmann Solutions bekommen hast. Ist er abgelaufen, bekommst du einen neuen.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          Zur Anmeldung
        </Link>
      </div>
    );
  }

  return (
    <PasswortForm
      tokenHash={token_hash ?? null}
      typ={typ}
      titel={token_hash && typ === "invite" ? "Willkommen! Lege dein Passwort fest" : "Neues Passwort festlegen"}
    />
  );
}
