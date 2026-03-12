create table if not exists public.planner_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  inventory jsonb not null default '[]'::jsonb,
  family jsonb not null default '[]'::jsonb,
  household_needs jsonb not null default '[]'::jsonb,
  cooked_meals jsonb not null default '{}'::jsonb,
  shopping_checked jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.planner_state enable row level security;

create policy "Users can read their own planner state"
on public.planner_state
for select
using (auth.uid() = user_id);

create policy "Users can insert their own planner state"
on public.planner_state
for insert
with check (auth.uid() = user_id);

create policy "Users can update their own planner state"
on public.planner_state
for update
using (auth.uid() = user_id);
