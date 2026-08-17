import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { UserRole, Profile } from "@/lib/types/database";

const STAFF_ROLES: UserRole[] = ["admin", "sales", "fulfillment"];
const CLIENT_ROLES: UserRole[] = ["client_owner", "client_member"];

export async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data as Profile | null;
}

export async function requireAuth(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireRole(roles: UserRole[]): Promise<Profile> {
  const profile = await requireAuth();
  if (!roles.includes(profile.role)) {
    redirect("/");
  }
  return profile;
}

export function isStaff(role: UserRole): boolean {
  return STAFF_ROLES.includes(role);
}

export function isClient(role: UserRole): boolean {
  return CLIENT_ROLES.includes(role);
}

export function getHomeRoute(role: UserRole): string {
  if (isStaff(role)) return "/sales";
  return "/dashboard";
}
