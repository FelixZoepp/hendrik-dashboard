"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut, Search } from "lucide-react";
import type { UserRole } from "@/lib/types/database";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { abmelden } from "@/lib/ansicht-aktionen";
import { navGroupsFor } from "./nav-config";

export function Topbar({
  role,
  userName,
  firmenName = null,
}: {
  role: UserRole;
  userName: string;
  firmenName?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const groups = navGroupsFor(role);
  const initials = (userName || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="hidden items-center justify-between gap-4 rounded-[1.75rem] bg-background px-4 py-3 lg:flex">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full max-w-md items-center gap-3 rounded-full bg-card px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="size-4" />
        <span className="flex-1">Seiten durchsuchen</span>
        <kbd className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">⌘ K</kbd>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-3 rounded-full py-1 pl-1 pr-3 outline-none transition-colors hover:bg-muted">
          <span className="flex size-10 items-center justify-center rounded-full bg-accent text-sm font-medium text-primary">
            {initials}
          </span>
          <span className="text-left leading-tight">
            <span className="block text-[15px] font-medium">{userName}</span>
            {firmenName && <span className="block text-xs text-muted-foreground">{firmenName}</span>}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{userName}</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/passwort-setzen")}>
            <KeyRound />
            Passwort ändern
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => abmelden()}>
            <LogOut />
            Abmelden
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CommandDialog open={open} onOpenChange={setOpen} title="Navigation" description="Seite suchen">
        <CommandInput placeholder="Wohin möchtest du?" />
        <CommandList>
          <CommandEmpty>Keine Seite gefunden.</CommandEmpty>
          {groups.map((g) => (
            <CommandGroup key={g.label} heading={g.label}>
              {g.items.map((item) => (
                <CommandItem
                  key={item.href}
                  value={item.label}
                  onSelect={() => {
                    setOpen(false);
                    router.push(item.href);
                  }}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </header>
  );
}
