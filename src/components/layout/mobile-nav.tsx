"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
import { useState } from "react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Sales", href: "/sales", icon: BarChart3, roles: ["admin", "sales"] },
  { label: "Marketing", href: "/marketing", icon: Megaphone, roles: ["admin"] },
  { label: "Fulfillment", href: "/fulfillment", icon: FolderKanban, roles: ["admin", "fulfillment"] },
  { label: "SOPs", href: "/sops", icon: BookOpen, roles: ["admin", "sales", "fulfillment"] },
  { label: "Reaktionszeiten", href: "/sla", icon: Timer, roles: ["admin"] },
  { label: "Kunden", href: "/kunden", icon: Building2, roles: ["admin"] },
  { label: "Team", href: "/team", icon: Users, roles: ["admin"] },
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["client_owner", "client_member"] },
  { label: "Leads", href: "/leads", icon: ClipboardList, roles: ["client_owner", "client_member"] },
  { label: "Akademie", href: "/akademie", icon: GraduationCap, roles: ["client_owner", "client_member"] },
  { label: "Downloads", href: "/downloads", icon: Download, roles: ["client_owner", "client_member"] },
  { label: "Formulare", href: "/formulare", icon: FileText, roles: ["client_owner"] },
];

export function MobileNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <div className="flex h-14 items-center border-b border-border bg-background px-4 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={<Button variant="ghost" size="icon" className="-ml-2" />}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Navigation öffnen</span>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-left text-sm">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
                H
              </div>
              Hoffman Solutions
            </SheetTitle>
          </SheetHeader>
          <nav className="px-3 py-3">
            <ul className="space-y-0.5">
              {items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-foreground/70 hover:bg-accent hover:text-accent-foreground"
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
        </SheetContent>
      </Sheet>
      <span className="ml-2 text-sm font-semibold">Hoffman Solutions</span>
    </div>
  );
}
