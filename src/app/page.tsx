import { redirect } from "next/navigation";
import { getProfile, getHomeRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  try {
    const profile = await getProfile();
    if (!profile) {
      redirect("/login");
    }
    redirect(getHomeRoute(profile.role));
  } catch {
    redirect("/login");
  }
}
