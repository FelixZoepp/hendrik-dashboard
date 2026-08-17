const CALENDLY_BASE_URL = "https://api.calendly.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendlyEvent {
  uri: string;
  name: string;
  status: "active" | "canceled";
  start_time: string;
  end_time: string;
  created_at: string;
  event_type: string;
  event_memberships: Array<{ user_email: string }>;
  cancellation?: {
    canceled_by: string;
    reason?: string;
    canceler_type: string;
  };
}

export interface CalendlyInvitee {
  uri: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
  no_show?: { uri: string } | null;
  cancellation?: {
    canceled_by: string;
    reason?: string;
    canceler_type: string;
  };
  tracking?: {
    utm_campaign?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_term?: string;
    utm_content?: string;
  };
}

interface CalendlyPaginatedResponse<T> {
  collection: T[];
  pagination: {
    count: number;
    next_page: string | null;
    previous_page: string | null;
    next_page_token: string | null;
  };
}

// ---------------------------------------------------------------------------
// Base API helper
// ---------------------------------------------------------------------------

async function calendlyApi<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const token = process.env.CALENDLY_TOKEN;
  if (!token) {
    throw new Error("Missing CALENDLY_TOKEN environment variable");
  }

  const url = new URL(`${CALENDLY_BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Calendly API error ${response.status} on ${path}: ${body}`,
    );
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Fetch scheduled events (paginated)
// ---------------------------------------------------------------------------

export async function fetchEvents(opts?: {
  minDate?: Date;
  maxDate?: Date;
  status?: "active" | "canceled";
}): Promise<CalendlyEvent[]> {
  const orgUri = process.env.CALENDLY_ORG_URI;
  if (!orgUri) {
    throw new Error("Missing CALENDLY_ORG_URI environment variable");
  }

  const allEvents: CalendlyEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = {
      organization: orgUri,
      count: "100",
    };

    if (opts?.minDate) {
      params.min_start_time = opts.minDate.toISOString();
    }
    if (opts?.maxDate) {
      params.max_start_time = opts.maxDate.toISOString();
    }
    if (opts?.status) {
      params.status = opts.status;
    }
    if (pageToken) {
      params.page_token = pageToken;
    }

    const data = await calendlyApi<CalendlyPaginatedResponse<CalendlyEvent>>(
      "/scheduled_events",
      params,
    );

    allEvents.push(...data.collection);
    pageToken = data.pagination.next_page_token ?? undefined;
  } while (pageToken);

  return allEvents;
}

// ---------------------------------------------------------------------------
// Fetch invitees for a specific event (paginated)
// ---------------------------------------------------------------------------

export async function fetchInvitees(
  eventUri: string,
): Promise<CalendlyInvitee[]> {
  // eventUri is the full URI, e.g. https://api.calendly.com/scheduled_events/{uuid}
  // We need just the UUID to build the API path
  const uuid = eventUri.split("/").pop();
  if (!uuid) {
    throw new Error(`Invalid event URI: ${eventUri}`);
  }

  const allInvitees: CalendlyInvitee[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = {
      count: "100",
    };

    if (pageToken) {
      params.page_token = pageToken;
    }

    const data = await calendlyApi<CalendlyPaginatedResponse<CalendlyInvitee>>(
      `/scheduled_events/${uuid}/invitees`,
      params,
    );

    allInvitees.push(...data.collection);
    pageToken = data.pagination.next_page_token ?? undefined;
  } while (pageToken);

  return allInvitees;
}
