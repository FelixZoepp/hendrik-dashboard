-- ============================================================
-- Phase 3: Fulfillment + SOPs
-- ============================================================

-- ============================================================
-- projects
-- ============================================================
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  typ             text not null check (typ in ('website', 'google_ads', 'tracking', 'sonstiges')),
  status          text not null default 'backlog' check (status in ('backlog', 'in_arbeit', 'review', 'live')),
  verantwortlich  uuid references public.profiles(id),
  deadline        date,
  live_url        text,
  notizen         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index projects_company_idx on public.projects(company_id);
create index projects_status_idx on public.projects(status);

create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.update_updated_at();

-- ============================================================
-- project_tasks
-- ============================================================
create table public.project_tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  titel         text not null,
  beschreibung  text,
  status        text not null default 'offen' check (status in ('offen', 'in_arbeit', 'erledigt')),
  assignee      uuid references public.profiles(id),
  due_date      date,
  sop_id        uuid, -- wird nach SOP-Tabelle als FK ergänzt
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index tasks_project_idx on public.project_tasks(project_id);
create index tasks_assignee_idx on public.project_tasks(assignee);

create trigger project_tasks_updated_at
  before update on public.project_tasks
  for each row execute function public.update_updated_at();

-- ============================================================
-- project_templates
-- ============================================================
create table public.project_templates (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  typ       text not null check (typ in ('website', 'google_ads', 'tracking', 'sonstiges')),
  tasks     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- sops
-- ============================================================
create table public.sops (
  id              uuid primary key default gen_random_uuid(),
  titel           text not null,
  kategorie       text not null,
  inhalt          text not null default '',
  rolle_sichtbar  text[] not null default '{admin,sales,fulfillment}',
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index sops_kategorie_idx on public.sops(kategorie);

create trigger sops_updated_at
  before update on public.sops
  for each row execute function public.update_updated_at();

-- FK für project_tasks.sop_id
alter table public.project_tasks
  add constraint project_tasks_sop_fk
  foreign key (sop_id) references public.sops(id) on delete set null;

-- ============================================================
-- RLS
-- ============================================================
alter table public.projects enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_templates enable row level security;
alter table public.sops enable row level security;

-- Projects: Staff sieht alles
create policy "projects_staff" on public.projects for all using (public.is_staff());

-- Projects: Client sieht eigene
create policy "projects_client" on public.projects for select
  using (company_id = (select p.company_id from public.profiles p where p.id = auth.uid()));

-- Tasks: Staff sieht alles
create policy "tasks_staff" on public.project_tasks for all using (public.is_staff());

-- Tasks: Client sieht Tasks eigener Projekte (read-only)
create policy "tasks_client" on public.project_tasks for select
  using (
    project_id in (
      select pr.id from public.projects pr
      where pr.company_id = (select p.company_id from public.profiles p where p.id = auth.uid())
    )
  );

-- Templates: nur Staff
create policy "templates_staff" on public.project_templates for all using (public.is_staff());

-- SOPs: basierend auf rolle_sichtbar
create policy "sops_select" on public.sops for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role::text = any(rolle_sichtbar)
    )
  );

-- SOPs: nur Admin darf schreiben
create policy "sops_write_admin" on public.sops for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ============================================================
-- Seed: Project Templates
-- ============================================================
insert into public.project_templates (name, typ, tasks) values
(
  'Website Handwerker Standard',
  'website',
  '[
    {"titel": "Zugangsdaten vom Kunden einsammeln", "beschreibung": "Domain-Registrar, Google Business, Fotos/Logo"},
    {"titel": "Keyword-Recherche für Gewerk", "beschreibung": "Hauptkeywords + Long-Tail für die Region"},
    {"titel": "Seitenstruktur anlegen", "beschreibung": "Above-the-Fold, Leistungen, Referenzen, Kontaktformular"},
    {"titel": "Above-the-Fold gestalten", "beschreibung": "Hero-Bild, Headline, CTA, Vertrauenselemente"},
    {"titel": "Leistungsbereich schreiben", "beschreibung": "USPs, Gewerke, Einzugsgebiet"},
    {"titel": "Trust-Elemente einbauen", "beschreibung": "Bewertungen, Siegel, Referenzprojekte"},
    {"titel": "Kontaktformular konfigurieren", "beschreibung": "Felder: Name, Tel, PLZ, Anliegen. Webhook einrichten"},
    {"titel": "Impressum & Datenschutz", "beschreibung": "Rechtlich korrekt, an Firmendaten anpassen"},
    {"titel": "Mobile-Check", "beschreibung": "Alle Breakpoints testen, Formular mobil prüfen"},
    {"titel": "Ladezeit optimieren", "beschreibung": "Bilder komprimieren, Lighthouse > 90"},
    {"titel": "Tracking-Setup", "beschreibung": "GTM, Conversion-Tracking, Formular-Events"},
    {"titel": "Domain verbinden + SSL", "beschreibung": "DNS umstellen, SSL prüfen"},
    {"titel": "Go-Live + Smoke-Test", "beschreibung": "Formular testen, Tracking verifizieren, Webhook prüfen"}
  ]'::jsonb
),
(
  'Google Ads Handwerker Standard',
  'google_ads',
  '[
    {"titel": "Google Ads Konto einrichten/MCC-Freigabe", "beschreibung": "Konto anlegen oder Zugriff über MCC"},
    {"titel": "Conversion-Tracking konfigurieren", "beschreibung": "Formular-Submit als Conversion, Wert hinterlegen"},
    {"titel": "Kampagnenstruktur anlegen", "beschreibung": "1 Kampagne pro Gewerk, Standort-Targeting mit Radius"},
    {"titel": "Keyword-Sets erstellen", "beschreibung": "Exact + Phrase Match, Negativliste anlegen"},
    {"titel": "Anzeigen schreiben", "beschreibung": "3 RSAs pro Anzeigengruppe, CTA, Sitelinks, Callouts"},
    {"titel": "Budget + Gebotsstrategie setzen", "beschreibung": "Tagesbudget berechnen, Maximize Conversions starten"},
    {"titel": "Kampagne starten", "beschreibung": "Final-Check, dann aktivieren"},
    {"titel": "Tag 3: Erste Daten prüfen", "beschreibung": "Impressions, Klicks, CTR, Suchbegriffe"},
    {"titel": "Tag 7: Suchbegriffe bereinigen", "beschreibung": "Irrelevante Begriffe als Negativ, gute als Exact"},
    {"titel": "Tag 14: Erste Optimierung", "beschreibung": "Anzeigen-Performance, Gebote anpassen, Budget prüfen"}
  ]'::jsonb
);
