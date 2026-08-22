const GRAPH_API = "https://graph.facebook.com/v21.0";

const TOKEN =
  process.env.META_ACCESS_TOKEN || "";
const AD_ACCOUNT =
  process.env.META_AD_ACCOUNT_ID || "";

export interface MetaInsight {
  date_start: string;
  date_stop: string;
  campaign_id: string;
  campaign_name: string;
  adset_name: string;
  ad_name: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpc: string;
  actions?: Array<{ action_type: string; value: string }>;
}

export async function fetchAdInsights(opts?: {
  since?: string; // YYYY-MM-DD
  until?: string; // YYYY-MM-DD
}): Promise<MetaInsight[]> {
  if (!TOKEN || !AD_ACCOUNT) {
    throw new Error("META_ACCESS_TOKEN or META_AD_ACCOUNT_ID missing");
  }

  const since = opts?.since ?? getDateDaysAgo(90);
  const until = opts?.until ?? getToday();

  const allInsights: MetaInsight[] = [];
  let nextUrl: string | null = buildUrl(since, until);

  while (nextUrl) {
    const res: Response = await fetch(nextUrl);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta API ${res.status}: ${body}`);
    }

    const data: { data?: MetaInsight[]; paging?: { next?: string } } = await res.json();
    allInsights.push(...(data.data ?? []));

    nextUrl = data.paging?.next ?? null;
  }

  return allInsights;
}

function buildUrl(since: string, until: string): string {
  const params = new URLSearchParams({
    access_token: TOKEN,
    level: "ad",
    fields: "campaign_id,campaign_name,adset_name,ad_name,spend,impressions,clicks,ctr,cpc,actions",
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    limit: "500",
  });

  return `${GRAPH_API}/${AD_ACCOUNT}/insights?${params.toString()}`;
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}
