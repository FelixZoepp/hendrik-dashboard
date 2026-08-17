import { requireRole } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NavUser } from "@/components/layout/nav-user";

export default async function AgencyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["admin", "sales", "fulfillment"]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={profile.role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <MobileNav role={profile.role} />
        <header className="hidden lg:flex h-14 items-center justify-end border-b border-border bg-background px-4">
          <NavUser profile={profile} />
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
