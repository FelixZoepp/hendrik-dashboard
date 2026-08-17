import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { SopLibrary } from "./sop-library";

export const metadata: Metadata = { title: "SOPs" };
export const dynamic = "force-dynamic";

export default async function SopsPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: sops } = await supabase
    .from("sops")
    .select("id, titel, kategorie, updated_at")
    .order("kategorie")
    .order("titel");

  return <SopLibrary sops={sops ?? []} />;
}
