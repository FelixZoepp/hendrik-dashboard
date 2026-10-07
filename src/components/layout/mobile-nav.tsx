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
import { useState } from "react";
import { Brand } from "./brand";
import { navGroupsFor, isActivePath } from "./nav-config";

export function MobileNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = navGroupsFor(role).flatMap((g) => g.items);

  return (
    <div className="flex h-14 items-center bg-background px-4 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={<Button variant="ghost" size="icon" className="-ml-2" />}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Navigation öffnen</span>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="px-5 py-5">
            <SheetTitle className="text-left">
              <Brand />
            </SheetTitle>
          </SheetHeader>
          <nav className="px-3 py-3">
            <ul className="space-y-0.5">
              {items.map((item) => {
                const isActive = isActivePath(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors",
                        isActive
                          ? "bg-accent text-primary font-semibold"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
      <div className="ml-2"><Brand /></div>
    </div>
  );
}
