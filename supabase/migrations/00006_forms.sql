-- ============================================================
-- Phase 4: Formulare
-- ============================================================

create table public.form_submissions (
  id          uuid primary key default gen_random_uuid(),
  typ         text not null check (typ in ('after_close', 'onboarding', 'zugaenge', 'abstellung', 'feedback')),
  company_id  uuid references public.companies(id) on delete set null,
  submitted_by uuid references public.profiles(id),
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'neu' check (status in ('neu', 'bearbeitet', 'archiviert')),
  created_at  timestamptz not null default now()
);

create index form_submissions_typ_idx on public.form_submissions(typ);
create index form_submissions_company_idx on public.form_submissions(company_id);

-- RLS
alter table public.form_submissions enable row level security;

-- Staff sieht alles
create policy "form_submissions_staff" on public.form_submissions for all using (public.is_staff());

-- Client sieht eigene Company-Submissions
create policy "form_submissions_client_select" on public.form_submissions for select
  using (company_id = (select p.company_id from public.profiles p where p.id = auth.uid()));

-- Client kann Submissions anlegen
create policy "form_submissions_client_insert" on public.form_submissions for insert
  with check (company_id = (select p.company_id from public.profiles p where p.id = auth.uid()));
