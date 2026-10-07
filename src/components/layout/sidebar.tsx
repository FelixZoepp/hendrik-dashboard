"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/types/database";
import { RefreshCw } from "lucide-react";
import { Brand } from "./brand";
import { navGroupsFor, isActivePath } from "./nav-config";

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const groups = navGroupsFor(role);

  return (
    <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:rounded-[1.75rem] lg:bg-sidebar lg:px-5 lg:py-6">
      <div className="px-2">
        <Brand />
      </div>
      <nav className="mt-8 flex-1 space-y-7 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {group.label}
            </p>
            <ul className="mt-3 space-y-1">
              {group.items.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.href} className="relative">
                    {active && (
                      <span className="absolute -left-5 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
                    )}
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-2 py-2 text-[15px] transition-colors",
                        active
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                      )}
                    >
                      <item.icon
                        className={cn("size-5 shrink-0", active && "text-primary")}
                        strokeWidth={active ? 2.25 : 1.75}
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="fern-hero mt-6 p-5">
        <span className="flex size-8 items-center justify-center rounded-full bg-white text-primary">
          <RefreshCw className="size-4" />
        </span>
        <p className="mt-4 text-lg font-medium leading-tight">Live-Daten</p>
        <p className="mt-1 text-xs text-white/70">
          Close, Calendly &amp; Meta Ads — täglich synchronisiert
        </p>
      </div>
    </aside>
  );
}
