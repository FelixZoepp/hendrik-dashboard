import { AppShell } from "@/components/layout/app-shell";
import { requireTeam } from "@/lib/kontext";

export default async function AgencyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireTeam();
  return (
    <AppShell
      role={ctx.rolle}
      userName={ctx.profile.full_name || ctx.email || "Team"}
      rollenAnsicht={ctx.rollenAnsicht ? (ctx.rolle === "sales" ? "Sales" : "Fulfillment") : null}
    >
      {children}
    </AppShell>
  );
}
