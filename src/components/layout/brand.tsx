import Link from "next/link";
import { Sprout } from "lucide-react";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-xl border-2 border-primary/80 text-primary">
        <Sprout className="size-5" strokeWidth={2.25} />
      </span>
      <span className="text-xl font-semibold tracking-tight">Hoffman</span>
    </Link>
  );
}
