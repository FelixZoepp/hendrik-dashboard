import { redirect } from "next/navigation";
import { getKontext } from "@/lib/kontext";
import { startseiteFuer } from "@/lib/zugriff";

export default async function RootPage() {
  const ctx = await getKontext();
  redirect(ctx ? startseiteFuer(ctx.rolle) : "/login");
}
