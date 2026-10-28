import type { UserRole } from "@/lib/types/database";
import { ansichtBeenden } from "@/lib/ansicht-aktionen";
import { Eye } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { MobileNav } from "./mobile-nav";

export function AppShell({
  role,
  userName,
  firmenName = null,
  impersoniert = false,
  glocke = null,
  children,
}: {
  /** Rolle für die Navigation (beim „Als Kunde ansehen“: client_owner). */
  role: UserRole;
  userName: string;
  firmenName?: string | null;
  impersoniert?: boolean;
  /** Kundenportal: Glocke mit Meldungen (Topbar + Mobil) */
  glocke?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      {impersoniert && firmenName && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-signal px-4 py-2 text-sm font-medium text-signal-foreground">
          <span className="flex items-center gap-2">
            <Eye className="size-4" />
            Du siehst die Cloud als <strong>{firmenName}</strong>
          </span>
          <form action={ansichtBeenden}>
            <button type="submit" className="rounded-full bg-signal-foreground px-3 py-0.5 text-xs font-semibold text-white hover:opacity-90">
              Beenden
            </button>
          </form>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden lg:p-4">
        <Sidebar role={role} />
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden">
          <MobileNav role={role} glocke={glocke} />
          <Topbar role={role} userName={userName} firmenName={firmenName} glocke={glocke} />
          <main className="flex-1 overflow-y-auto bg-background px-4 py-6 lg:rounded-[1.75rem] lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
