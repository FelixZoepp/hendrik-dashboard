-- ============================================================
-- Phase 6: Akademie — Kurse, Lektionen, Fortschritt, Downloads
-- ============================================================

create table public.courses (
  id              uuid primary key default gen_random_uuid(),
  titel           text not null,
  beschreibung    text,
  reihenfolge     integer not null default 0,
  created_at      timestamptz not null default now()
);

create table public.lessons (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.courses(id) on delete cascade,
  titel           text not null,
  beschreibung    text,
  video_url       text,
  dauer           integer, -- Minuten
  reihenfolge     integer not null default 0,
  freigeschaltet_ab integer not null default 0, -- Tage nach Onboarding
  created_at      timestamptz not null default now()
);

create index lessons_course_idx on public.lessons(course_id);

create table public.lesson_progress (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  lesson_id       uuid not null references public.lessons(id) on delete cascade,
  abgeschlossen_am timestamptz not null default now(),
  unique(user_id, lesson_id)
);

create table public.downloads (
  id              uuid primary key default gen_random_uuid(),
  titel           text not null,
  datei           text not null, -- Supabase Storage path
  kategorie       text not null,
  sichtbar_fuer   text[] not null default '{client_owner,client_member}',
  created_at      timestamptz not null default now()
);

-- RLS
alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.downloads enable row level security;

-- Kurse + Lektionen: alle authentifizierten User
create policy "courses_select" on public.courses for select using (auth.uid() is not null);
create policy "lessons_select" on public.lessons for select using (auth.uid() is not null);

-- Admin kann schreiben
create policy "courses_admin" on public.courses for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "lessons_admin" on public.lessons for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Progress: eigener Fortschritt
create policy "progress_own" on public.lesson_progress for all
  using (user_id = auth.uid());

-- Downloads: basierend auf sichtbar_fuer
create policy "downloads_select" on public.downloads for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role::text = any(sichtbar_fuer)
    )
    or public.is_staff()
  );

create policy "downloads_admin" on public.downloads for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ============================================================
-- Seed: Startkurse
-- ============================================================
insert into public.courses (titel, beschreibung, reihenfolge) values
('Leadbearbeitung Basics', 'Wie du Anfragen richtig bearbeitest und mehr Aufträge gewinnst', 1),
('Was du von deiner Kampagne erwarten kannst', 'Realistische Erwartungen, Zahlen und Zusammenhänge', 2);

-- Lektionen für Kurs 1
with kurs1 as (select id from public.courses where titel = 'Leadbearbeitung Basics')
insert into public.lessons (course_id, titel, beschreibung, dauer, reihenfolge, freigeschaltet_ab) values
((select id from kurs1), 'So arbeitest du Leads richtig ab', 'Schritt für Schritt: Von der Anfrage zum Auftrag', 8, 1, 0),
((select id from kurs1), 'Die ersten 15 Minuten', 'Warum schnelle Reaktion den Unterschied macht', 5, 2, 0),
((select id from kurs1), 'Angebot am Telefon', 'Wie du im Erstgespräch bereits einen Auftrag sicherst', 10, 3, 3),
((select id from kurs1), 'Typische Fehler vermeiden', 'Die häufigsten Fehler bei der Leadbearbeitung', 6, 4, 7);

-- Lektionen für Kurs 2
with kurs2 as (select id from public.courses where titel = 'Was du von deiner Kampagne erwarten kannst')
insert into public.lessons (course_id, titel, beschreibung, dauer, reihenfolge, freigeschaltet_ab) values
((select id from kurs2), 'Wie Google Ads funktioniert', 'Grundlagen, die du als Handwerker wissen musst', 7, 1, 0),
((select id from kurs2), 'Deine Zahlen verstehen', 'Was CPL, CTR und Co. bedeuten', 6, 2, 0),
((select id from kurs2), 'Realistische Erwartungen', 'Was du in den ersten 4 Wochen erwarten kannst', 8, 3, 7);
