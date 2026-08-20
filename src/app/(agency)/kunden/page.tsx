import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

import { KundenView } from "./kunden-view";
import type { Company } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Kunden",
};

export const dynamic = "force-dynamic";

export default async function KundenPage() {

  const supabase = createAdminClient();

  const { data } = await supabase
    .from("companies")
    .select("*")
    .order("name", { ascending: true });

  return <KundenView companies={(data as Company[]) ?? []} />;
}
