import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KundenView } from "./kunden-view";
import type { Company } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Kunden",
};

export const dynamic = "force-dynamic";

export default async function KundenPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const { data } = await supabase
    .from("companies")
    .select("*")
    .order("name", { ascending: true });

  return <KundenView companies={(data as Company[]) ?? []} />;
}
