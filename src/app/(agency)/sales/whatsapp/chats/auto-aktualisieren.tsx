"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Lädt die Server-Daten regelmäßig neu, solange der Tab sichtbar ist. */
export function AutoAktualisieren({ sekunden }: { sekunden: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, sekunden * 1000);
    return () => clearInterval(id);
  }, [router, sekunden]);
  return null;
}
