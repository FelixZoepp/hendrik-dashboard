import type { UserRole } from "@/lib/types/database";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { MobileNav } from "./mobile-nav";

export function AppShell({
  role,
  children,
}: {
  role: UserRole;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen gap-4 overflow-hidden bg-canvas lg:p-4">
      <Sidebar role={role} />
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden">
        <MobileNav role={role} />
        <Topbar role={role} />
        <main className="flex-1 overflow-y-auto bg-background px-4 py-6 lg:rounded-[1.75rem] lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
