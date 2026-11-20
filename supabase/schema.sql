-- Meow Meow Club adoption records: database setup.
-- Run once: Supabase dashboard > SQL Editor > New query > paste all of this > Run.
-- Safe to run again; it will not delete any records.

-- ---------------------------------------------------------------
-- 1. Who may use the app (a short allow-list of signed-in people)
-- ---------------------------------------------------------------
create table if not exists public.staff (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('admin', 'volunteer')),
  display_name text not null default '',
  created_at   timestamptz not null default now()
);
alter table public.staff enable row level security;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and role = 'admin');
$$;

revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_staff() to authenticated;
grant  execute on function public.is_admin() to authenticated;

drop policy if exists "staff read own" on public.staff;
create policy "staff read own" on public.staff for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on public.staff from anon, authenticated;
grant select on public.staff to authenticated;

-- ---------------------------------------------------------------
-- 2. Receipt counters (one counter per year, updated atomically)
-- ---------------------------------------------------------------
create table if not exists public.receipt_counters (
  year     int primary key,
  last_seq int not null
);
alter table public.receipt_counters enable row level security;
revoke all on public.receipt_counters from anon, authenticated;

-- ---------------------------------------------------------------
-- 3. Adoption records
-- ---------------------------------------------------------------
create table if not exists public.adoptions (
  id              uuid primary key default gen_random_uuid(),
  receipt_no      text not null unique,
  receipt_year    int  not null,
  receipt_seq     int  not null,
  issued_on       date not null default ((now() at time zone 'Asia/Singapore')::date),
  adoption_date   date not null,
  cat_name        text not null check (length(trim(cat_name)) > 0),
  sex             text not null default '',
  age             text not null default '',
  colour          text not null default '',
  microchip       text not null default '',
  sterilised      text not null default '',
  vaccinated      text not null default '',
  photo_path      text,
  fee             numeric(10,2) not null default 0 check (fee >= 0),
  currency        text not null default 'SGD',
  method          text not null default 'Cash'
                  check (method in ('Cash', 'PayNow', 'Bank transfer', 'Card', 'Waived')),
  handled_by      text not null default '',
  adopter_name    text not null check (length(trim(adopter_name)) > 0),
  phone           text not null default '',
  email           text not null default '',
  address         text not null default '',
  notes           text not null default '',
  terms_agreed    boolean not null default false,
  pdpa_consent    boolean not null default false,
  pdpa_consent_at timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  updated_by_name text not null default '',
  updated_at      timestamptz not null default now(),
  check (phone <> '' or email <> '')
);
create index if not exists adoptions_date_idx on public.adoptions (adoption_date desc, created_at desc);

-- Before a new record is saved: give it the next receipt number and stamp who created it.
create or replace function public.adoptions_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  y int; s int; m text[]; custom boolean;
begin
  new.created_by      := auth.uid();
  new.created_by_name := coalesce((select display_name from public.staff where user_id = auth.uid()), '');
  new.created_at      := now();
  new.updated_by      := null;
  new.updated_by_name := '';
  new.updated_at      := now();

  -- A receipt number may be supplied only by an admin or from the SQL editor (for importing old records).
  custom := coalesce(new.receipt_no, '') <> '' and (auth.uid() is null or public.is_admin());

  if not custom then
    y := extract(year from new.issued_on)::int;
    insert into public.receipt_counters (year, last_seq) values (y, 1)
      on conflict (year) do update set last_seq = public.receipt_counters.last_seq + 1
      returning last_seq into s;
    new.receipt_year := y;
    new.receipt_seq  := s;
    new.receipt_no   := 'MMC-' || y || '-' || lpad(s::text, 4, '0');
  else
    m := regexp_match(new.receipt_no, '^MMC-(\d{4})-(\d{4,})$');
    if m is null then
      raise exception 'Receipt number must look like MMC-2026-0001';
    end if;
    new.receipt_year := m[1]::int;
    new.receipt_seq  := m[2]::int;
    insert into public.receipt_counters (year, last_seq) values (new.receipt_year, new.receipt_seq)
      on conflict (year) do update set last_seq = greatest(public.receipt_counters.last_seq, excluded.last_seq);
  end if;

  if new.pdpa_consent then
    new.pdpa_consent_at := coalesce(new.pdpa_consent_at, now());
  else
    new.pdpa_consent_at := null;
  end if;
  return new;
end $$;

drop trigger if exists adoptions_before_insert on public.adoptions;
create trigger adoptions_before_insert before insert on public.adoptions
  for each row execute function public.adoptions_before_insert();

-- Before a record is edited: keep the receipt number fixed and stamp who edited it.
create or replace function public.adoptions_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.id              := old.id;
  new.receipt_no      := old.receipt_no;
  new.receipt_year    := old.receipt_year;
  new.receipt_seq     := old.receipt_seq;
  new.issued_on       := old.issued_on;
  new.created_by      := old.created_by;
  new.created_by_name := old.created_by_name;
  new.created_at      := old.created_at;
  new.updated_by      := auth.uid();
  new.updated_by_name := coalesce((select display_name from public.staff where user_id = auth.uid()), '');
  new.updated_at      := now();
  if new.pdpa_consent then
    new.pdpa_consent_at := coalesce(old.pdpa_consent_at, now());
  else
    new.pdpa_consent_at := null;
  end if;
  return new;
end $$;

drop trigger if exists adoptions_before_update on public.adoptions;
create trigger adoptions_before_update before update on public.adoptions
  for each row execute function public.adoptions_before_update();

-- Row-level security: staff read, add and edit; only admins delete.
alter table public.adoptions enable row level security;

drop policy if exists "staff read"   on public.adoptions;
drop policy if exists "staff add"    on public.adoptions;
drop policy if exists "staff edit"   on public.adoptions;
drop policy if exists "admin delete" on public.adoptions;

create policy "staff read"   on public.adoptions for select to authenticated using (public.is_staff());
create policy "staff add"    on public.adoptions for insert to authenticated with check (public.is_staff());
create policy "staff edit"   on public.adoptions for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "admin delete" on public.adoptions for delete to authenticated using (public.is_admin());

revoke all on public.adoptions from anon, authenticated;
grant select, insert, update, delete on public.adoptions to authenticated;

-- ---------------------------------------------------------------
-- 4. Private storage for cat photos (JPEG only, 5 MB each)
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cat-photos', 'cat-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists "staff read photos"   on storage.objects;
drop policy if exists "staff add photos"    on storage.objects;
drop policy if exists "staff change photos" on storage.objects;
drop policy if exists "staff remove photos" on storage.objects;

create policy "staff read photos"   on storage.objects for select to authenticated
  using (bucket_id = 'cat-photos' and public.is_staff());
create policy "staff add photos"    on storage.objects for insert to authenticated
  with check (bucket_id = 'cat-photos' and public.is_staff());
create policy "staff change photos" on storage.objects for update to authenticated
  using (bucket_id = 'cat-photos' and public.is_staff())
  with check (bucket_id = 'cat-photos' and public.is_staff());
create policy "staff remove photos" on storage.objects for delete to authenticated
  using (bucket_id = 'cat-photos' and public.is_staff());
