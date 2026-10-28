"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Öffnet den Druckdialog des Browsers – dort „Als PDF speichern“ wählen. */
export function DruckenKnopf() {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer />
      Als PDF speichern
    </Button>
  );
}
