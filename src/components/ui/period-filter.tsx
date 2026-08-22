"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

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
    <div className="flex items-center gap-1 rounded-md border bg-muted p-0.5">
      {PERIODS.map((p) => (
        <Button
          key={p.value}
          variant={current === p.value ? "default" : "ghost"}
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => handleChange(p.value)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}
