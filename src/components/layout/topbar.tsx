"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { UserRole } from "@/lib/types/database";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { navGroupsFor } from "./nav-config";

export function Topbar({
  role,
  userName = "Hendrik Hoffmann",
}: {
  role: UserRole;
  userName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const groups = navGroupsFor(role);
  const initials = userName
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
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-accent text-sm font-medium text-primary">
          {initials}
        </span>
        <span className="text-[15px] font-medium">{userName}</span>
      </div>

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
