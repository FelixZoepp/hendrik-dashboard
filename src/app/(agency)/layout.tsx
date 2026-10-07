import { AppShell } from "@/components/layout/app-shell";

export default function AgencyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell role="admin">{children}</AppShell>;
}
