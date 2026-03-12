create table if not exists public.planner_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  inventory jsonb not null default '[]'::jsonb,
  family jsonb not null default '[]'::jsonb,
  user_recipes jsonb not null default '[]'::jsonb,
  household_needs jsonb not null default '[]'::jsonb,
  cooked_meals jsonb not null default '{}'::jsonb,
  meal_cooking_for jsonb not null default '{}'::jsonb,
  meal_recipe_overrides jsonb not null default '{}'::jsonb,
  shopping_checked jsonb not null default '{}'::jsonb,
  shopping_extras jsonb not null default '[]'::jsonb,
  purchase_history jsonb not null default '[]'::jsonb,
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

create table if not exists public.product_cache (
  barcode text primary key,
  product jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.product_cache enable row level security;

create policy "Anyone can read product cache"
on public.product_cache
for select
using (true);

create policy "Anyone can insert product cache"
on public.product_cache
for insert
with check (true);

create policy "Anyone can update product cache"
on public.product_cache
for update
using (true)
with check (true);
