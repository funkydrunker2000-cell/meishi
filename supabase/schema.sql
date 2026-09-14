-- 営業名刺帳 — Supabase の初期設定
-- 使い方：Supabase ダッシュボード → SQL Editor → New query に全文を貼り付けて「Run」。
-- 何度実行しても壊れないように書いてあります（既存データは消えません）。

-- ───────────── テーブル ─────────────

-- 社員の表示名（営業履歴の担当者欄に使う）
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at   timestamptz not null default now()
);

-- 訪問先
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  industry    text not null default '',
  phone       text not null default '',
  address     text not null default '',
  url         text not null default '',
  memo        text not null default '',
  stage       text not null default '営業中' check (stage in ('営業中', '受注', '見送り')),
  prospect    text not null default '' check (prospect in ('', 'A', 'B', 'C')),
  next_action text not null default '',
  next_date   date,
  steps       jsonb not null default '{}'::jsonb,   -- 受注後の手続きチェック {ad, ringi, hearing}
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 名刺（先方担当者）
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  kana        text not null default '',
  department  text not null default '',
  title       text not null default '',
  phone       text not null default '',
  mobile      text not null default '',
  email       text not null default '',
  fax         text not null default '',
  photo_path  text,                                  -- Storage「cards」バケット内のパス
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 営業履歴
create table if not exists public.visits (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  date          date not null default current_date,
  method        text not null default '訪問',
  staff         text not null default '',
  contact_ids   uuid[] not null default '{}',
  other_contact text not null default '',
  memo          text not null default '',
  prospect      text not null default '' check (prospect in ('', 'A', 'B', 'C')),
  next_action   text not null default '',
  next_date     date,
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists contacts_company_idx on public.contacts (company_id);
create index if not exists visits_company_date_idx on public.visits (company_id, date desc);

-- 更新日時を自動で入れる
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists companies_updated_at on public.companies;
create trigger companies_updated_at before update on public.companies for each row execute function public.set_updated_at();
drop trigger if exists contacts_updated_at on public.contacts;
create trigger contacts_updated_at before update on public.contacts for each row execute function public.set_updated_at();
drop trigger if exists visits_updated_at on public.visits;
create trigger visits_updated_at before update on public.visits for each row execute function public.set_updated_at();

-- ───────────── アクセス権（RLS） ─────────────
-- 新規登録を無効にし、招待した社員だけがログインできる前提で、
-- 「ログイン済みの社員は全員、全データを見て編集できる」設定にしています。
-- ログインしていない人（anon）は何も読めません。

grant select, insert, update, delete on public.companies, public.contacts, public.visits, public.profiles to authenticated;

alter table public.profiles  enable row level security;
alter table public.companies enable row level security;
alter table public.contacts  enable row level security;
alter table public.visits    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['companies', 'contacts', 'visits'] loop
    execute format('drop policy if exists "社員は閲覧できる" on public.%I', t);
    execute format('create policy "社員は閲覧できる" on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists "社員は追加できる" on public.%I', t);
    execute format('create policy "社員は追加できる" on public.%I for insert to authenticated with check (true)', t);
    execute format('drop policy if exists "社員は編集できる" on public.%I', t);
    execute format('create policy "社員は編集できる" on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('drop policy if exists "社員は削除できる" on public.%I', t);
    execute format('create policy "社員は削除できる" on public.%I for delete to authenticated using (true)', t);
  end loop;
end $$;

drop policy if exists "社員は表示名を閲覧できる" on public.profiles;
create policy "社員は表示名を閲覧できる" on public.profiles for select to authenticated using (true);
drop policy if exists "自分の表示名を登録できる" on public.profiles;
create policy "自分の表示名を登録できる" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "自分の表示名を変更できる" on public.profiles;
create policy "自分の表示名を変更できる" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ───────────── リアルタイム更新 ─────────────
-- 他の社員が登録・編集した内容が、開いている画面にすぐ反映されるようにする
do $$
declare t text;
begin
  foreach t in array array['companies', 'contacts', 'visits'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ───────────── 名刺画像の保存場所（Storage） ─────────────
-- 非公開バケット。画面では期限付きURLで表示します。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cards', 'cards', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "社員は名刺画像を見られる" on storage.objects;
create policy "社員は名刺画像を見られる" on storage.objects for select to authenticated using (bucket_id = 'cards');
drop policy if exists "社員は名刺画像を保存できる" on storage.objects;
create policy "社員は名刺画像を保存できる" on storage.objects for insert to authenticated with check (bucket_id = 'cards');
drop policy if exists "社員は名刺画像を差し替えできる" on storage.objects;
create policy "社員は名刺画像を差し替えできる" on storage.objects for update to authenticated using (bucket_id = 'cards') with check (bucket_id = 'cards');
drop policy if exists "社員は名刺画像を削除できる" on storage.objects;
create policy "社員は名刺画像を削除できる" on storage.objects for delete to authenticated using (bucket_id = 'cards');
