import Link from "next/link";
import { LogoMark } from "./logo-mark";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3">
      <LogoMark className="size-10 text-foreground" />
      <span className="leading-tight">
        <span className="block text-lg font-semibold tracking-tight">Hoffman</span>
        <span className="block text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Solutions</span>
      </span>
    </Link>
  );
}
