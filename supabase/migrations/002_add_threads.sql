-- Comps: Threads / Continuation (docs/THREADS_CONTINUATION_PLAN.md)
-- Run once in the Supabase SQL editor, AFTER 001_init.sql. Safe to re-run: every step is guarded and the
-- backfill only touches runs whose thread_id is still null. One transaction: any failure rolls everything back.
--
-- Naming: the repo convention is a sequential prefix (001_init.sql), so this is 002_, not a timestamp.
--
-- Not touched: runs.status, runs.user_id, existing runs policies/grants, profiles, usage counting
-- (still counts successful rows in runs by user_id).

begin;

-- ---------------------------------------------------------------------------
-- threads: one row per research conversation
-- ---------------------------------------------------------------------------
create table if not exists public.threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- History list: a user's threads, most recently active first.
create index if not exists threads_user_id_updated_at_idx
  on public.threads (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- runs.thread_id
-- Nullable on purpose: the currently deployed /api/agent inserts runs WITHOUT thread_id until the
-- backend step ships, and those inserts must keep working. Re-running the backfill section below
-- later picks up any such rows. NOT NULL can be added in a follow-up migration once the app always sets it.
-- FK is the default NO ACTION (not cascade): deleting a thread can never silently delete runs, which are
-- the usage-count source of truth. Account deletion still works (auth.users -> profiles -> runs).
-- ---------------------------------------------------------------------------
alter table public.runs
  add column if not exists thread_id uuid references public.threads (id);

create index if not exists runs_thread_id_created_at_idx
  on public.runs (thread_id, created_at asc);

-- ---------------------------------------------------------------------------
-- Backfill: exactly one thread per existing run that has no thread yet.
-- Blocks concurrent inserts/updates on runs for the duration of this transaction so no run can slip in
-- between the snapshot and the update (reads are unaffected).
-- ---------------------------------------------------------------------------
lock table public.runs in share row exclusive mode;

create temporary table _runs_before on commit drop as
  select count(*) as total,
         count(*) filter (where status = 'success') as successes,
         count(*) filter (where status = 'failed')  as failures
  from public.runs;

create temporary table _thread_map on commit drop as
  select id as run_id, gen_random_uuid() as thread_id
  from public.runs
  where thread_id is null;

insert into public.threads (id, user_id, title, created_at, updated_at)
select m.thread_id,
       r.user_id,
       coalesce(nullif(left(btrim(r.question), 120), ''), 'Untitled research'),
       r.created_at,
       r.created_at
from _thread_map m
join public.runs r on r.id = m.run_id;

update public.runs r
set thread_id = m.thread_id
from _thread_map m
where r.id = m.run_id
  and r.thread_id is null;

-- ---------------------------------------------------------------------------
-- Row-level security (same model as 001_init.sql: policy + table grant, both layers)
-- The app writes with the admin client (bypasses RLS); these policies govern direct browser-key access.
-- No DELETE policy or grant: thread deletion is out of scope.
-- ---------------------------------------------------------------------------
alter table public.threads enable row level security;

drop policy if exists "Users can view own threads" on public.threads;
create policy "Users can view own threads"
  on public.threads for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own threads" on public.threads;
create policy "Users can insert own threads"
  on public.threads for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own threads" on public.threads;
create policy "Users can update own threads"
  on public.threads for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.threads from anon;
revoke delete, truncate on public.threads from authenticated;
grant select, insert, update on public.threads to authenticated;
grant all on public.threads to service_role;

-- ---------------------------------------------------------------------------
-- Self-check: abort (rolling back everything) unless the backfill is complete and consistent.
-- ---------------------------------------------------------------------------
do $$
declare
  b record;
  a record;
begin
  select * into b from _runs_before;
  select count(*) as total,
         count(*) filter (where status = 'success') as successes,
         count(*) filter (where status = 'failed')  as failures,
         count(*) filter (where thread_id is null)  as unthreaded,
         count(*) filter (where thread_id is not null
                          and not exists (select 1 from public.threads t
                                          where t.id = runs.thread_id and t.user_id = runs.user_id)) as mismatched
  into a
  from public.runs;

  if a.total <> b.total or a.successes <> b.successes or a.failures <> b.failures then
    raise exception 'threads migration: run counts changed (before % / % / %, after % / % / %)',
      b.total, b.successes, b.failures, a.total, a.successes, a.failures;
  end if;
  if a.unthreaded <> 0 then
    raise exception 'threads migration: % runs still have no thread_id', a.unthreaded;
  end if;
  if a.mismatched <> 0 then
    raise exception 'threads migration: % runs have a missing thread or an owner mismatch', a.mismatched;
  end if;
end
$$;

commit;
