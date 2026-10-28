import type { UserRole } from "@/lib/types/database";
import {
  BarChart3,
  Magnet,
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
  MessageCircle,
  MessagesSquare,
  PhoneCall,
  Tag,
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

const TEAM: UserRole[] = ["admin", "sales", "fulfillment"];
const KUNDE: UserRole[] = ["client_owner", "client_member"];

/** Navigation im internen Bereich (src/app/(agency)). */
export const TEAM_NAV: NavGroup[] = [
  {
    label: "Menü",
    items: [
      { label: "Sales", href: "/sales", icon: BarChart3, roles: ["admin", "sales"] },
      { label: "WhatsApp-Bot", href: "/sales/whatsapp", icon: MessageCircle, roles: ["admin", "sales"] },
      { label: "WhatsApp-Chats", href: "/sales/whatsapp/chats", icon: MessagesSquare, roles: ["admin", "sales"] },
      { label: "Gespräche", href: "/sales/gespraeche", icon: PhoneCall, roles: ["admin", "sales"] },
      { label: "Verlustgrund", href: "/sales/verlustgrund", icon: Tag, roles: ["admin", "sales"] },
      { label: "Funnels", href: "/sales/funnels", icon: Magnet, roles: ["admin", "sales"] },
      { label: "Marketing", href: "/marketing", icon: Megaphone, roles: ["admin"] },
      { label: "Fulfillment", href: "/fulfillment", icon: FolderKanban, roles: ["admin", "fulfillment"] },
      { label: "Kunden", href: "/kunden", icon: Building2, roles: TEAM },
      { label: "Team", href: "/team", icon: Users, roles: ["admin"] },
    ],
  },
  {
    label: "Allgemein",
    items: [
      { label: "SOPs", href: "/sops", icon: BookOpen, roles: TEAM },
      { label: "Reaktionszeiten", href: "/sla", icon: Timer, roles: ["admin"] },
    ],
  },
];

/**
 * Navigation im Kundenportal (src/app/(client)). Neue Kundenseite = eine Zeile in der
 * passenden Gruppe ergänzen (und den Pfad in KUNDEN_PRAEFIXE in src/lib/zugriff.ts).
 */
export const KUNDEN_NAV: NavGroup[] = [
  {
    label: "Aufträge",
    items: [
      { label: "Start", href: "/dashboard", icon: LayoutDashboard, roles: KUNDE },
      { label: "Leads", href: "/leads", icon: ClipboardList, roles: KUNDE },
    ],
  },
  {
    label: "Wachstum",
    items: [
      { label: "Kampagne", href: "/kampagne", icon: Megaphone, roles: KUNDE },
      { label: "Masterclass", href: "/akademie", icon: GraduationCap, roles: KUNDE },
      { label: "Downloads", href: "/downloads", icon: Download, roles: KUNDE },
    ],
  },
  {
    label: "Einstellungen",
    items: [
      { label: "Projektstatus", href: "/status", icon: Kanban, roles: KUNDE },
      { label: "Formulare", href: "/forms/after-close", icon: FileText, roles: ["client_owner"] },
    ],
  },
];

export const NAV_GROUPS: NavGroup[] = [...TEAM_NAV, ...KUNDEN_NAV];

export function navGroupsFor(role: UserRole): NavGroup[] {
  const quelle = KUNDE.includes(role) ? KUNDEN_NAV : TEAM_NAV;
  return quelle.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles.includes(role)),
  })).filter((g) => g.items.length > 0);
}

export function isActivePath(pathname: string, href: string): boolean {
  const passt = (h: string) => pathname === h || pathname.startsWith(h + "/");
  if (!passt(href)) return false;
  // Spezifischerer Menüpunkt (z. B. /sales/whatsapp) hat Vorrang vor /sales
  return !NAV_GROUPS.some((g) =>
    g.items.some((i) => i.href.startsWith(href + "/") && passt(i.href)),
  );
}
