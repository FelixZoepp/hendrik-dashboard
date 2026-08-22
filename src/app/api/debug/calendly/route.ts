import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.CALENDLY_TOKEN || process.env.CALENDLY_API_KEY;

  if (!token) {
    return NextResponse.json({ error: "No Calendly token" });
  }

  try {
    // 1. Get current user + org
    const meRes = await fetch("https://api.calendly.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meData = await meRes.json();

    if (!meRes.ok) {
      return NextResponse.json({ error: "users/me failed", details: meData });
    }

    const orgUri = meData.resource?.current_organization;

    // 2. Try to fetch events
    const eventsUrl = new URL("https://api.calendly.com/scheduled_events");
    eventsUrl.searchParams.set("organization", orgUri);
    eventsUrl.searchParams.set("count", "5");
    eventsUrl.searchParams.set("status", "active");

    const eventsRes = await fetch(eventsUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const eventsData = await eventsRes.json();

    return NextResponse.json({
      user: meData.resource?.name,
      orgUri,
      eventsStatus: eventsRes.status,
      eventsCount: eventsData.collection?.length ?? 0,
      firstEvent: eventsData.collection?.[0]?.name ?? null,
      error: eventsRes.ok ? null : eventsData,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Unknown",
    });
  }
}
