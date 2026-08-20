import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { FulfillmentBoard } from "./fulfillment-board";

export const metadata: Metadata = { title: "Fulfillment" };
export const dynamic = "force-dynamic";

export default async function FulfillmentPage() {
  const supabase = createAdminClient();

  const [projectsRes, companiesRes] = await Promise.all([
    supabase
      .from("projects")
      .select("*, project_tasks(*), companies(name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("companies")
      .select("id, name, status")
      .in("status", ["aktiv", "onboarding"]),
  ]);

  return (
    <FulfillmentBoard
      projects={projectsRes.data ?? []}
      companies={companiesRes.data ?? []}
      currentUserId={""}
      isAdmin={"admin" === "admin"}
    />
  );
}
