"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { UserRole } from "@/lib/types/database";

type RoleFilter = "alle" | "admin" | "sales" | "fulfillment" | "kunden";

const ROLE_TABS: { label: string; value: RoleFilter }[] = [
  { label: "Alle", value: "alle" },
  { label: "Admin", value: "admin" },
  { label: "Sales", value: "sales" },
  { label: "Fulfillment", value: "fulfillment" },
  { label: "Kunden", value: "kunden" },
];

const ROLE_STYLES: Record<UserRole, string> = {
  admin: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  sales: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  fulfillment: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  client_owner: "bg-green-500/15 text-green-700 dark:text-green-400",
  client_member: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  sales: "Sales",
  fulfillment: "Fulfillment",
  client_owner: "Kunde (Owner)",
  client_member: "Kunde",
};

const CLIENT_ROLES: UserRole[] = ["client_owner", "client_member"];

interface ProfileWithCompany {
  id: string;
  full_name: string;
  role: string;
  company_id: string | null;
  avatar_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  companies: { name: string } | null;
}

interface CloseUser {
  close_id: string;
  name: string;
  email: string;
  rolle: string;
}

interface TeamViewProps {
  profiles: ProfileWithCompany[];
  closeUsers: CloseUser[];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function matchesFilter(role: string, filter: RoleFilter): boolean {
  if (filter === "alle") return true;
  if (filter === "kunden") return CLIENT_ROLES.includes(role as UserRole);
  return role === filter;
}

export function TeamView({ profiles, closeUsers }: TeamViewProps) {
  const [activeTab, setActiveTab] = useState<RoleFilter>("alle");

  const filtered = useMemo(() => {
    return profiles.filter((p) => matchesFilter(p.role, activeTab));
  }, [profiles, activeTab]);

  const tabCounts = useMemo(() => {
    const counts: Record<RoleFilter, number> = {
      alle: profiles.length,
      admin: profiles.filter((p) => p.role === "admin").length,
      sales: profiles.filter((p) => p.role === "sales").length,
      fulfillment: profiles.filter((p) => p.role === "fulfillment").length,
      kunden: profiles.filter((p) =>
        CLIENT_ROLES.includes(p.role as UserRole)
      ).length,
    };
    return counts;
  }, [profiles]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          {filtered.length}{" "}
          {filtered.length === 1 ? "Mitglied" : "Mitglieder"}
          {closeUsers.length > 0 && (
            <span> · {closeUsers.length} Close-Nutzer</span>
          )}
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {ROLE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
              activeTab === tab.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "text-xs font-mono tabular-nums",
                activeTab === tab.value
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground"
              )}
            >
              {tabCounts[tab.value]}
            </span>
          </button>
        ))}
      </div>

      {/* Team member list */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Keine Teammitglieder gefunden.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((member) => {
            const role = member.role as UserRole;
            return (
              <div
                key={member.id}
                className="flex items-center gap-3 rounded-lg border bg-card p-4"
              >
                <Avatar>
                  <AvatarFallback>
                    {getInitials(member.full_name)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">
                      {member.full_name}
                    </p>
                    <span
                      className={cn(
                        "inline-flex h-2 w-2 shrink-0 rounded-full",
                        member.active ? "bg-green-500" : "bg-gray-400"
                      )}
                      title={member.active ? "Aktiv" : "Inaktiv"}
                    />
                  </div>

                  <div className="mt-1 flex items-center gap-2">
                    <Badge
                      className={cn(
                        "shrink-0 border-transparent",
                        ROLE_STYLES[role]
                      )}
                    >
                      {ROLE_LABELS[role]}
                    </Badge>
                    {member.companies?.name && (
                      <span className="text-xs text-muted-foreground truncate">
                        {member.companies.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
