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
  Kanban,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Menü",
    items: [
      { label: "Sales", href: "/sales", icon: BarChart3, roles: ["admin", "sales"] },
      { label: "Marketing", href: "/marketing", icon: Megaphone, roles: ["admin"] },
      { label: "Fulfillment", href: "/fulfillment", icon: FolderKanban, roles: ["admin", "fulfillment"] },
      { label: "Kunden", href: "/kunden", icon: Building2, roles: ["admin"] },
      { label: "Team", href: "/team", icon: Users, roles: ["admin"] },
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["client_owner", "client_member"] },
      { label: "Leads", href: "/leads", icon: ClipboardList, roles: ["client_owner", "client_member"] },
      { label: "Projektstatus", href: "/status", icon: Kanban, roles: ["client_owner", "client_member"] },
    ],
  },
  {
    label: "Allgemein",
    items: [
      { label: "SOPs", href: "/sops", icon: BookOpen, roles: ["admin", "sales", "fulfillment"] },
      { label: "Reaktionszeiten", href: "/sla", icon: Timer, roles: ["admin"] },
      { label: "Akademie", href: "/akademie", icon: GraduationCap, roles: ["client_owner", "client_member"] },
      { label: "Downloads", href: "/downloads", icon: Download, roles: ["client_owner", "client_member"] },
      { label: "Formulare", href: "/forms/after-close", icon: FileText, roles: ["client_owner"] },
    ],
  },
];

export function navGroupsFor(role: UserRole): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles.includes(role)),
  })).filter((g) => g.items.length > 0);
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
