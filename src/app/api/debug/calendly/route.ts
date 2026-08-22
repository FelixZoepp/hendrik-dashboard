import { NextResponse } from "next/server";
import { subDays } from "date-fns";

export async function GET() {
  const token = process.env.CALENDLY_TOKEN || process.env.CALENDLY_API_KEY;
  if (!token) return NextResponse.json({ error: "No token" });

  try {
    // Get org
    const meRes = await fetch("https://api.calendly.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meData = await meRes.json();
    const orgUri = meData.resource?.current_organization;

    // Test with min_start_time (same as sync does)
    const minDate = subDays(new Date(), 90);
    const url = new URL("https://api.calendly.com/scheduled_events");
    url.searchParams.set("organization", orgUri);
    url.searchParams.set("count", "5");
    url.searchParams.set("status", "active");
    url.searchParams.set("min_start_time", minDate.toISOString());

    const fullUrl = url.toString();

    const res = await fetch(fullUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    return NextResponse.json({
      requestUrl: fullUrl,
      status: res.status,
      count: data.collection?.length ?? 0,
      error: res.ok ? null : data,
      pagination: data.pagination ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown" });
  }
}
