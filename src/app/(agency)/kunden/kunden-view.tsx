"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { Company, CompanyStatus } from "@/lib/types/database";
import { Building2, Mail, Phone, User, Search } from "lucide-react";

const STATUS_TABS: { label: string; value: CompanyStatus | "alle" }[] = [
  { label: "Alle", value: "alle" },
  { label: "Aktiv", value: "aktiv" },
  { label: "Onboarding", value: "onboarding" },
  { label: "Pausiert", value: "pausiert" },
  { label: "Gekündigt", value: "gekuendigt" },
];

const STATUS_STYLES: Record<CompanyStatus, string> = {
  aktiv: "bg-green-500/15 text-green-700 dark:text-green-400",
  onboarding: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  pausiert: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  gekuendigt: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const STATUS_LABELS: Record<CompanyStatus, string> = {
  aktiv: "Aktiv",
  onboarding: "Onboarding",
  pausiert: "Pausiert",
  gekuendigt: "Gekündigt",
};

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

interface KundenViewProps {
  companies: Company[];
}

export function KundenView({ companies }: KundenViewProps) {
  const [activeTab, setActiveTab] = useState<CompanyStatus | "alle">("alle");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let result = companies;

    if (activeTab !== "alle") {
      result = result.filter((c) => c.status === activeTab);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.ansprechpartner?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.branche?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [companies, activeTab, search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Kunden</h1>
        <p className="text-sm text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "Kunde" : "Kunden"}
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {STATUS_TABS.map((tab) => {
            const count =
              tab.value === "alle"
                ? companies.length
                : companies.filter((c) => c.status === tab.value).length;
            return (
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
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {/* Company list */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Keine Kunden gefunden.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((company) => (
            <Link
              key={company.id}
              href={`/kunden/${company.id}`}
              className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <p className="text-sm font-semibold truncate">
                      {company.name}
                    </p>
                  </div>
                </div>
                <Badge
                  className={cn(
                    "shrink-0 border-transparent",
                    STATUS_STYLES[company.status]
                  )}
                >
                  {STATUS_LABELS[company.status]}
                </Badge>
              </div>

              <div className="mt-3 space-y-1.5">
                {company.ansprechpartner && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <User className="h-3 w-3 shrink-0" />
                    <span className="truncate">{company.ansprechpartner}</span>
                  </div>
                )}
                {company.email && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3 shrink-0" />
                    <span className="truncate">{company.email}</span>
                  </div>
                )}
                {company.telefon && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3 shrink-0" />
                    <span className="truncate">{company.telefon}</span>
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3">
                <div className="flex items-center gap-3">
                  {company.branche && (
                    <span className="text-xs text-muted-foreground">
                      {company.branche}
                    </span>
                  )}
                  {company.start_datum && (
                    <span className="text-xs text-muted-foreground">
                      Seit{" "}
                      {new Date(company.start_datum).toLocaleDateString(
                        "de-DE",
                        { month: "2-digit", year: "numeric" }
                      )}
                    </span>
                  )}
                </div>
                {company.monatliches_retainer != null && (
                  <span className="text-xs font-medium font-mono tabular-nums">
                    {currencyFormatter.format(company.monatliches_retainer)}/Mo
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
