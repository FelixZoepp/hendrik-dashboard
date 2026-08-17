"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/types/database";
import {
  BarChart3,
  ClipboardList,
  FolderKanban,
  BookOpen,
  FileText,
  Timer,
  Megaphone,
  Users,
  Building2,
  LayoutDashboard,
  GraduationCap,
  Download,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  // Agentur
  {
    label: "Sales",
    href: "/sales",
    icon: BarChart3,
    roles: ["admin", "sales"],
  },
  {
    label: "Marketing",
    href: "/marketing",
    icon: Megaphone,
    roles: ["admin"],
  },
  {
    label: "Fulfillment",
    href: "/fulfillment",
    icon: FolderKanban,
    roles: ["admin", "fulfillment"],
  },
  {
    label: "SOPs",
    href: "/sops",
    icon: BookOpen,
    roles: ["admin", "sales", "fulfillment"],
  },
  {
    label: "Reaktionszeiten",
    href: "/sla",
    icon: Timer,
    roles: ["admin"],
  },
  {
    label: "Kunden",
    href: "/kunden",
    icon: Building2,
    roles: ["admin"],
  },
  {
    label: "Team",
    href: "/team",
    icon: Users,
    roles: ["admin"],
  },
  // Kunden
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: ["client_owner", "client_member"],
  },
  {
    label: "Leads",
    href: "/leads",
    icon: ClipboardList,
    roles: ["client_owner", "client_member"],
  },
  {
    label: "Akademie",
    href: "/akademie",
    icon: GraduationCap,
    roles: ["client_owner", "client_member"],
  },
  {
    label: "Downloads",
    href: "/downloads",
    icon: Download,
    roles: ["client_owner", "client_member"],
  },
  {
    label: "Formulare",
    href: "/formulare",
    icon: FileText,
    roles: ["client_owner"],
  },
];

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-sidebar-border lg:bg-sidebar">
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
            H
          </div>
          <span className="text-sm font-semibold text-sidebar-foreground">
            Hoffman Solutions
          </span>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <ul className="space-y-0.5">
          {items.map((item) => {
            const isActive =
              pathname === item.href ||
              pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
