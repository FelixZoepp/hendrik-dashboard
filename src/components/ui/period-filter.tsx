"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const PERIODS = [
  { label: "7T", value: "7" },
  { label: "30T", value: "30" },
  { label: "90T", value: "90" },
  { label: "Max", value: "9999" },
] as const;

export function PeriodFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("tage") ?? "90";

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tage", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-card p-1.5 shadow-[0_1px_2px_rgb(22_26_23/0.04),0_8px_24px_-12px_rgb(22_26_23/0.08)]">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => handleChange(p.value)}
          className={cn(
            "rounded-full px-4 py-2 text-sm transition-colors",
            current === p.value
              ? "fern-btn-primary font-medium text-white"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
