// Close CRM API Client
// Docs: https://developer.close.com/

const CLOSE_BASE_URL = "https://api.close.com/api/v1";
const DEFAULT_LIMIT = 100;
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloseLead {
  id: string;
  display_name: string;
  status_label: string;
  status_type: string;
  date_created: string;
  date_updated: string;
  lead_source?: string;
  custom?: Record<string, unknown>;
  assigned_to?: string;
}

export interface CloseOpportunity {
  id: string;
  lead_id: string;
  value: number;
  value_period: string;
  status_label: string;
  status_type: string;
  confidence: number;
  date_won?: string;
  user_id: string;
  date_created: string;
}

export interface CloseActivity {
  id: string;
  lead_id: string;
  _type: string; // Call, Email, SMS, Note, Meeting
  direction?: string;
  duration?: number;
  user_id: string;
  date_created: string;
  disposition?: string;
}

export interface CloseUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface PaginatedResponse<T> {
  data: T[];
  has_more: boolean;
  total_results?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.CLOSE_API_KEY;
  if (!key) {
    throw new Error("CLOSE_API_KEY environment variable is not set");
  }
  return key;
}

function buildAuthHeader(): string {
  const key = getApiKey();
  // Close uses Basic Auth: API key as username, empty password
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Core API fetch with auth, pagination & rate-limit retry
// ---------------------------------------------------------------------------

export async function closeApi<T>(
  path: string,
  options?: {
    params?: Record<string, string>;
    method?: string;
    body?: unknown;
  },
): Promise<T> {
  const method = options?.method ?? "GET";
  const url = new URL(`${CLOSE_BASE_URL}${path}`);

  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(),
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const fetchOptions: RequestInit = { method, headers };
  if (options?.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  let retries = 0;

  while (true) {
    const response = await fetch(url.toString(), fetchOptions);

    if (response.status === 429) {
      if (retries >= MAX_RETRIES) {
        throw new Error(
          `Close API rate limit exceeded after ${MAX_RETRIES} retries: ${method} ${path}`,
        );
      }

      // Use Retry-After header if present, otherwise exponential backoff
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : INITIAL_BACKOFF_MS * Math.pow(2, retries);

      retries++;
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Close API error ${response.status} on ${method} ${path}: ${errorBody}`,
      );
    }

    return (await response.json()) as T;
  }
}

// ---------------------------------------------------------------------------
// Paginated fetch helper — collects all pages into a single array
// ---------------------------------------------------------------------------

async function fetchAllPaginated<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T[]> {
  const all: T[] = [];
  let skip = 0;

  while (true) {
    const queryParams: Record<string, string> = {
      ...params,
      _skip: String(skip),
      _limit: String(DEFAULT_LIMIT),
    };

    const page = await closeApi<PaginatedResponse<T>>(path, {
      params: queryParams,
    });

    all.push(...page.data);

    if (!page.has_more) {
      break;
    }

    skip += page.data.length;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/**
 * Fetch all leads, optionally filtered by date_updated since a given date.
 */
export async function fetchLeads(since?: Date): Promise<CloseLead[]> {
  const params: Record<string, string> = {};

  if (since) {
    // Close API uses query syntax for filtering
    params.query = `date_updated >= ${since.toISOString()}`;
  }

  return fetchAllPaginated<CloseLead>("/lead/", params);
}

/**
 * Fetch all opportunities, optionally filtered by date_created since a given date.
 */
export async function fetchOpportunities(
  since?: Date,
): Promise<CloseOpportunity[]> {
  const params: Record<string, string> = {};

  if (since) {
    params.date_created__gte = since.toISOString();
  }

  return fetchAllPaginated<CloseOpportunity>("/opportunity/", params);
}

/**
 * Fetch all activities across all types (Call, Email, SMS, Note, Meeting),
 * optionally filtered by date_created since a given date.
 */
export async function fetchActivities(
  since?: Date,
): Promise<CloseActivity[]> {
  const activityEndpoints = [
    "/activity/call/",
    "/activity/email/",
    "/activity/sms/",
    "/activity/note/",
    "/activity/meeting/",
  ] as const;

  const params: Record<string, string> = {};
  if (since) {
    params.date_created__gte = since.toISOString();
  }

  const results = await Promise.all(
    activityEndpoints.map((endpoint) =>
      fetchAllPaginated<CloseActivity>(endpoint, params),
    ),
  );

  // Flatten all activity types into a single array, sorted by date_created desc
  return results
    .flat()
    .sort(
      (a, b) =>
        new Date(b.date_created).getTime() -
        new Date(a.date_created).getTime(),
    );
}

/**
 * Fetch all users in the Close organization.
 */
export async function fetchUsers(): Promise<CloseUser[]> {
  return fetchAllPaginated<CloseUser>("/user/");
}

/**
 * Fetch custom activities (z.B. Gesprächsprotokoll).
 * Close Custom Activities haben eigene Endpoints: /activity/custom_activity/{custom_activity_type_id}/
 * Alternativ: /activity/?_type=CustomActivity
 */
export interface CloseCustomActivity {
  id: string;
  lead_id: string;
  _type: string;
  custom_activity_type_id: string;
  user_id: string;
  date_created: string;
  status: string;
  fields?: Record<string, unknown>;
}

export async function fetchCustomActivities(
  since?: Date,
): Promise<CloseCustomActivity[]> {
  // Erst alle Custom Activity Types holen
  const types = await fetchCustomActivityTypes();
  if (types.length === 0) return [];

  // Pro Type die Activities fetchen
  const allActivities: CloseCustomActivity[] = [];
  for (const type of types) {
    const params: Record<string, string> = {};
    if (since) {
      params.date_created__gte = since.toISOString();
    }

    try {
      const activities = await fetchAllPaginated<CloseCustomActivity>(
        `/activity/${type.id}/`,
        params,
      );
      // Type-Name mitgeben
      for (const a of activities) {
        a.custom_activity_type_id = type.id;
      }
      allActivities.push(...activities);
    } catch {
      // Typ hat vielleicht keine Activities, ignorieren
    }
  }

  return allActivities;
}

/**
 * Fetch custom activity types to identify which one is "Gesprächsprotokoll"
 */
export interface CloseCustomActivityType {
  id: string;
  name: string;
  organization_id: string;
}

export async function fetchCustomActivityTypes(): Promise<CloseCustomActivityType[]> {
  try {
    const response = await closeApi<{ data: CloseCustomActivityType[] }>(
      "/custom_activity_type/",
    );
    return response.data;
  } catch {
    // Falls der Endpoint nicht existiert, leeres Array
    return [];
  }
}
