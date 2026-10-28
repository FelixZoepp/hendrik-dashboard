import { AppShell } from "@/components/layout/app-shell";
import { requireKunde } from "@/lib/kontext";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireKunde();
  return (
    <AppShell
      role={ctx.istTeam ? "client_owner" : ctx.rolle}
      userName={ctx.profile.full_name || ctx.email || "Kunde"}
      firmenName={ctx.company.name}
      impersoniert={ctx.impersoniert}
    >
      {children}
    </AppShell>
  );
}
