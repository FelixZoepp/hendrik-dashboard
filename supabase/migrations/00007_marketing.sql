-- ============================================================
-- Phase 5: Marketing — Meta + Google Ads Insights
-- ============================================================

create table public.meta_ad_insights (
  id              uuid primary key default gen_random_uuid(),
  date            date not null,
  campaign_id     text,
  campaign_name   text,
  adset_name      text,
  ad_name         text,
  spend           numeric(10,2) not null default 0,
  impressions     integer not null default 0,
  clicks          integer not null default 0,
  ctr             numeric(6,4) default 0,
  cpc             numeric(8,2) default 0,
  leads           integer not null default 0,
  cost_per_lead   numeric(8,2) default 0,
  company_id      uuid references public.companies(id),
  created_at      timestamptz not null default now(),
  unique(date, campaign_id, adset_name, ad_name)
);

create index meta_insights_date_idx on public.meta_ad_insights(date desc);
create index meta_insights_campaign_idx on public.meta_ad_insights(campaign_id);

create table public.google_ads_insights (
  id              uuid primary key default gen_random_uuid(),
  date            date not null,
  campaign_id     text,
  campaign_name   text,
  adset_name      text,
  ad_name         text,
  spend           numeric(10,2) not null default 0,
  impressions     integer not null default 0,
  clicks          integer not null default 0,
  ctr             numeric(6,4) default 0,
  cpc             numeric(8,2) default 0,
  leads           integer not null default 0,
  cost_per_lead   numeric(8,2) default 0,
  company_id      uuid not null references public.companies(id),
  created_at      timestamptz not null default now(),
  unique(date, campaign_id, company_id)
);

create index google_insights_date_idx on public.google_ads_insights(date desc);
create index google_insights_company_idx on public.google_ads_insights(company_id);

-- RLS
alter table public.meta_ad_insights enable row level security;
alter table public.google_ads_insights enable row level security;

-- Staff sieht alles
create policy "meta_insights_staff" on public.meta_ad_insights for all using (public.is_staff());
create policy "google_insights_staff" on public.google_ads_insights for all using (public.is_staff());

-- Client sieht eigene Google Ads
create policy "google_insights_client" on public.google_ads_insights for select
  using (company_id = (select p.company_id from public.profiles p where p.id = auth.uid()));
