import type { Metadata } from "next";
import { sichererZielpfad } from "@/lib/zugriff";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Anmelden",
  robots: { index: false, follow: false },
};

const FEHLER: Record<string, string> = {
  gesperrt: "Dein Zugang ist gesperrt. Bitte melde dich bei Hoffmann Solutions.",
  auth: "Der Link ist abgelaufen oder ungültig. Bitte fordere einen neuen an.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; fehler?: string; error?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const fehler = FEHLER[sp.fehler ?? sp.error ?? ""] ?? null;
  const hinweis = sp.ok === "passwort" ? "Passwort gespeichert. Du kannst dich jetzt anmelden." : null;
  return <LoginForm next={sichererZielpfad(sp.next, "/")} fehler={fehler} hinweis={hinweis} />;
}
