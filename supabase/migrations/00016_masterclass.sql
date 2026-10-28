-- ============================================================
-- 00016: Masterclass (Verkaufen & Auftragsfindung für Handwerksbetriebe)
--
-- Baut auf der Akademie aus 00008 auf: Modul = public.courses, Lektion = public.lessons.
-- Bestehende Kurse, Lektionen und lesson_progress bleiben unverändert und sichtbar
-- (neue Spalten haben Standardwerte, status = 'veroeffentlicht').
-- Idempotent: mehrfach ausführbar. Nur additive Änderungen, außer den beiden
-- Lese-Policies auf courses/lessons, die Entwürfe vor Kunden verbergen.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Module (courses)
-- ------------------------------------------------------------
alter table public.courses add column if not exists status text not null default 'veroeffentlicht';
alter table public.courses drop constraint if exists courses_status_check;
alter table public.courses add constraint courses_status_check check (status in ('entwurf', 'veroeffentlicht'));
-- https-URL oder Pfad im Storage-Bucket „masterclass“
alter table public.courses add column if not exists bild_url text;
-- „Erst nach Modul X“ (optional)
alter table public.courses add column if not exists voraussetzung_course_id uuid references public.courses(id) on delete set null;
alter table public.courses add column if not exists updated_at timestamptz not null default now();

-- ------------------------------------------------------------
-- 2. Lektionen (lessons)
-- ------------------------------------------------------------
alter table public.lessons add column if not exists status text not null default 'veroeffentlicht';
alter table public.lessons drop constraint if exists lessons_status_check;
alter table public.lessons add constraint lessons_status_check check (status in ('entwurf', 'veroeffentlicht'));
alter table public.lessons add column if not exists typ text not null default 'video';
alter table public.lessons drop constraint if exists lessons_typ_check;
alter table public.lessons add constraint lessons_typ_check check (typ in ('video', 'text'));
-- Kapitel = Abschnitt innerhalb eines Moduls (Seitenleiste)
alter table public.lessons add column if not exists kapitel text;
-- Quelltext aus dem Editor (Markdown) + daraus erzeugtes, gefiltertes HTML
alter table public.lessons add column if not exists content_md text;
alter table public.lessons add column if not exists content_html text;
-- [{ "name": "Leitfaden.pdf", "pfad": "lektionen/<id>/…" } | { "name": "…", "url": "https://…" }]
alter table public.lessons add column if not exists anhaenge jsonb not null default '[]'::jsonb;
-- Sprungmarken im Video: [{ "sekunden": 75, "titel": "Einwände" }]
alter table public.lessons add column if not exists zeitmarken jsonb not null default '[]'::jsonb;
alter table public.lessons add column if not exists updated_at timestamptz not null default now();
create index if not exists lessons_course_reihenfolge_idx on public.lessons(course_id, reihenfolge);

-- ------------------------------------------------------------
-- 3. Fortschritt je Person + Firma
-- ------------------------------------------------------------
alter table public.lesson_progress add column if not exists company_id uuid references public.companies(id) on delete cascade;
create index if not exists lesson_progress_company_idx on public.lesson_progress(company_id);

-- Bestehenden Fortschritt der Firma der Person zuordnen
update public.lesson_progress lp
   set company_id = p.company_id
  from public.profiles p
 where p.id = lp.user_id and lp.company_id is null and p.company_id is not null;

-- ------------------------------------------------------------
-- 4. Aufgaben je Lektion + Abhaken je Person
-- ------------------------------------------------------------
create table if not exists public.lesson_tasks (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons(id) on delete cascade,
  titel        text not null,
  beschreibung text,
  reihenfolge  integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists lesson_tasks_lesson_idx on public.lesson_tasks(lesson_id);

create table if not exists public.lesson_task_progress (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  task_id      uuid not null references public.lesson_tasks(id) on delete cascade,
  company_id   uuid references public.companies(id) on delete cascade,
  erledigt_am  timestamptz not null default now(),
  primary key (user_id, task_id)
);
create index if not exists lesson_task_progress_company_idx on public.lesson_task_progress(company_id);

-- ------------------------------------------------------------
-- 5. Freischaltung je Firma
--    Kein Eintrag = Standard (frei bzw. „erst nach Modul X“).
--    freigeschaltet = true  → immer frei (übersteuert die Voraussetzung)
--    freigeschaltet = false → für diese Firma gesperrt
-- ------------------------------------------------------------
create table if not exists public.masterclass_freischaltungen (
  company_id     uuid not null references public.companies(id) on delete cascade,
  course_id      uuid not null references public.courses(id) on delete cascade,
  freigeschaltet boolean not null,
  geaendert_von  uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (company_id, course_id)
);

-- ------------------------------------------------------------
-- 6. RLS
--    Die App liest/schreibt über die Service-Rolle (Server). Policies sind die zweite Linie.
-- ------------------------------------------------------------
alter table public.lesson_tasks enable row level security;
alter table public.lesson_task_progress enable row level security;
alter table public.masterclass_freischaltungen enable row level security;

-- Inhalte nur fürs Team lesbar. Kunden lesen ausschließlich über den Server (Service-Rolle),
-- der Freischaltung je Firma + Veröffentlichung prüft — eine Kunden-Lese-Policy würde die
-- Freischaltung umgehen (direkter PostgREST-Zugriff mit Kunden-JWT).
drop policy if exists "courses_select" on public.courses;
create policy "courses_select" on public.courses for select
  using (public.is_staff());

drop policy if exists "lessons_select" on public.lessons;
create policy "lessons_select" on public.lessons for select
  using (public.is_staff());

drop policy if exists "lesson_tasks_select" on public.lesson_tasks;
create policy "lesson_tasks_select" on public.lesson_tasks for select
  using (public.is_staff());
drop policy if exists "lesson_tasks_staff" on public.lesson_tasks;
create policy "lesson_tasks_staff" on public.lesson_tasks for all
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "lesson_task_progress_own" on public.lesson_task_progress;
create policy "lesson_task_progress_own" on public.lesson_task_progress for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "lesson_task_progress_staff" on public.lesson_task_progress;
create policy "lesson_task_progress_staff" on public.lesson_task_progress for select
  using (public.is_staff());

drop policy if exists "lesson_progress_staff" on public.lesson_progress;
create policy "lesson_progress_staff" on public.lesson_progress for select
  using (public.is_staff());

drop policy if exists "mc_freischaltungen_select" on public.masterclass_freischaltungen;
create policy "mc_freischaltungen_select" on public.masterclass_freischaltungen for select
  using (public.is_staff() or company_id = public.eigene_company_id());
drop policy if exists "mc_freischaltungen_staff" on public.masterclass_freischaltungen;
create policy "mc_freischaltungen_staff" on public.masterclass_freischaltungen for all
  using (public.is_staff()) with check (public.is_staff());

-- ------------------------------------------------------------
-- 7. Storage-Bucket „masterclass“ (privat; Kunden bekommen signierte Links)
--    Upload aus dem Editor per signierter Upload-URL (Server erzeugt sie für das Team).
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('masterclass', 'masterclass', false, 104857600)
on conflict (id) do nothing;

drop policy if exists "masterclass_staff_all" on storage.objects;
create policy "masterclass_staff_all" on storage.objects for all
  using (bucket_id = 'masterclass' and public.is_staff())
  with check (bucket_id = 'masterclass' and public.is_staff());

-- ------------------------------------------------------------
-- 8. Gliederung „Verkaufen & Auftragsfindung“ — NUR ENTWÜRFE
--    Module und Lektionen sind unveröffentlicht (für Kunden unsichtbar).
--    Inhalte liefert Hendrik; die Lektionen tragen nur Platzhalter.
--    Bestehende Startkurse bleiben unverändert.
-- ------------------------------------------------------------
do $$
declare
  basis int;
  m uuid;
  modul record;
  lektion_titel text;
  i int;
begin
  select coalesce(max(reihenfolge), 0) into basis from public.courses;

  for modul in
    select * from (values
      (1, 'Start: So arbeitest du mit der Cloud',
          'Wo du deine Anfragen findest und wie du die Cloud im Alltag nutzt.',
          array['Willkommen in der Hoffmann Solutions Cloud', 'Deine Anfragen im Überblick', 'Die Cloud auf dem Handy']),
      (2, 'Leads in 5 Minuten anrufen',
          'Warum Tempo bei neuen Anfragen zählt und wie du es im Alltag schaffst.',
          array['Warum Tempo zählt', 'So erfährst du sofort von neuen Anfragen', 'Wenn niemand rangeht']),
      (3, 'Das erste Telefonat (Leitfaden)',
          'Der Ablauf des ersten Gesprächs mit einem Interessenten.',
          array['Der Gesprächsleitfaden', 'Die richtigen Fragen stellen', 'Den Vor-Ort-Termin vereinbaren']),
      (4, 'Der Vor-Ort-Termin',
          'Vorbereitung, Ablauf und nächster Schritt beim Kunden vor Ort.',
          array['Vorbereitung auf den Termin', 'Ablauf beim Kunden', 'Den nächsten Schritt festmachen']),
      (5, 'Angebot schreiben & nachfassen',
          'Vom Aufmaß zum Angebot – und was danach passiert.',
          array['Das Angebot', 'Nachfassen', 'Den Status in der Cloud pflegen']),
      (6, 'Preisgespräch führen',
          'Über den Preis sprechen, ohne sich unter Wert zu verkaufen.',
          array['Über den Preis sprechen', 'Typische Einwände', 'Zum Auftrag kommen']),
      (7, 'Bewertungen & Empfehlungen sammeln',
          'Zufriedene Kunden als Quelle für neue Aufträge.',
          array['Nach Bewertungen fragen', 'Empfehlungen bekommen'])
    ) as t(nr, titel, beschreibung, lektionen)
  loop
    -- Idempotent: Modul nur anlegen, wenn es noch nicht existiert
    if exists (select 1 from public.courses c where c.titel = modul.titel) then
      continue;
    end if;

    insert into public.courses (titel, beschreibung, reihenfolge, status)
    values (modul.titel, modul.beschreibung, basis + modul.nr, 'entwurf')
    returning id into m;

    i := 0;
    foreach lektion_titel in array modul.lektionen loop
      i := i + 1;
      insert into public.lessons (course_id, titel, typ, status, reihenfolge, freigeschaltet_ab, content_md, content_html)
      values (
        m, lektion_titel, 'video', 'entwurf', i, 0,
        'Inhalt folgt – Hendrik ergänzt: Video, Text und Aufgaben zu „' || lektion_titel || '“.',
        '<p>Inhalt folgt – Hendrik ergänzt: Video, Text und Aufgaben zu „' || lektion_titel || '“.</p>'
      );
    end loop;
  end loop;
end $$;
