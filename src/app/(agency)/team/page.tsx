import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTeam } from "@/lib/kontext";

import { TeamView } from "./team-view";

export const metadata: Metadata = {
  title: "Team",
};

export const dynamic = "force-dynamic";

interface ProfileWithCompany {
  id: string;
  full_name: string;
  role: string;
  company_id: string | null;
  avatar_url: string | null;
  email?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  companies: { name: string } | null;
}

interface CloseUser {
  close_id: string;
  name: string;
  email: string;
  rolle: string;
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  const ctx = await requireTeam(["admin"]);
  const { fehler } = await searchParams;
  const supabase = createAdminClient();

  const [profilesRes, closeUsersRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("*, companies(name)")
      .order("active", { ascending: false })
      .order("full_name", { ascending: true }),
    supabase.from("close_users").select("*"),
  ]);

  return (
    <TeamView
      profiles={(profilesRes.data as ProfileWithCompany[]) ?? []}
      closeUsers={(closeUsersRes.data as CloseUser[]) ?? []}
      eigeneId={ctx.profile.id}
      fehler={fehler ?? null}
    />
  );
}
