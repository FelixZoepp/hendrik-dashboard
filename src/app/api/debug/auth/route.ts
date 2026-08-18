import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    return NextResponse.json({
      hasUser: !!data?.user,
      userId: data?.user?.id ?? null,
      email: data?.user?.email ?? null,
      error: error?.message ?? null,
    });
  } catch (err) {
    return NextResponse.json({
      hasUser: false,
      error: err instanceof Error ? err.message : "Unknown",
    });
  }
}
