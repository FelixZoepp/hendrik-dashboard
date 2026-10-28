import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { UserRole, Profile } from "@/lib/types/database";
import { getKontext } from "@/lib/kontext";
import { istKundenRolle, istTeamRolle, startseiteFuer } from "@/lib/zugriff";

// Ältere Helfer — neue Seiten nutzen getKontext/requireTeam/requireKunde aus @/lib/kontext.

export async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(): Promise<Profile | null> {
  return (await getKontext())?.profile ?? null;
}

export async function requireAuth(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireRole(roles: UserRole[]): Promise<Profile> {
  const profile = await requireAuth();
  if (!roles.includes(profile.role)) {
    redirect(getHomeRoute(profile.role));
  }
  return profile;
}

export function isStaff(role: UserRole): boolean {
  return istTeamRolle(role);
}

export function isClient(role: UserRole): boolean {
  return istKundenRolle(role);
}

export function getHomeRoute(role: UserRole): string {
  return startseiteFuer(role);
}
