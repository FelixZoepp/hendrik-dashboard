import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

import { SopLibrary } from "./sop-library";

export const metadata: Metadata = { title: "SOPs" };
export const dynamic = "force-dynamic";

export default async function SopsPage() {

  const supabase = createAdminClient();

  const { data: sops } = await supabase
    .from("sops")
    .select("id, titel, kategorie, updated_at")
    .order("kategorie")
    .order("titel");

  return <SopLibrary sops={sops ?? []} />;
}
