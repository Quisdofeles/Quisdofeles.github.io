-- Finance module schema.
-- Every table is user-owned and isolated with row-level security, so one
-- account can never read or write another account's rows.

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  monthly_budget numeric(12, 2) not null default 0 check (monthly_budget >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index categories_user_id_idx on public.categories (user_id);

alter table public.categories enable row level security;

create policy "categories_owner" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger set_categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- transactions
-- Category is nullable: deleting a category shouldn't delete transaction
-- history, it just becomes "uncategorized" in the UI.
-- ---------------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  type text not null check (type in ('income', 'expense')),
  transaction_date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transactions_user_date_idx on public.transactions (user_id, transaction_date desc);
create index transactions_category_id_idx on public.transactions (category_id);

alter table public.transactions enable row level security;

create policy "transactions_owner" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger set_transactions_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- subscriptions
-- is_active lets a subscription be paused/cancelled without losing its
-- history, since it still rolls up into a category's spend total while active.
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  name text not null,
  amount numeric(12, 2) not null check (amount > 0),
  billing_frequency text not null check (billing_frequency in ('weekly', 'monthly', 'yearly')),
  next_charge_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions (user_id);
create index subscriptions_next_charge_idx on public.subscriptions (next_charge_date);

alter table public.subscriptions enable row level security;

create policy "subscriptions_owner" on public.subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger set_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- savings_goals + savings_contributions
-- current_amount is maintained by trigger from the contributions ledger
-- below, not written directly, so it can never drift from its own history.
-- ---------------------------------------------------------------------------
create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  goal_type text not null check (goal_type in ('want', 'reserve')),
  target_amount numeric(12, 2) not null check (target_amount >= 0),
  current_amount numeric(12, 2) not null default 0,
  monthly_contribution_target numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index savings_goals_user_id_idx on public.savings_goals (user_id);

alter table public.savings_goals enable row level security;

create policy "savings_goals_owner" on public.savings_goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger set_savings_goals_updated_at
  before update on public.savings_goals
  for each row execute function public.set_updated_at();

create table public.savings_contributions (
  id uuid primary key default gen_random_uuid(),
  savings_goal_id uuid not null references public.savings_goals (id) on delete cascade,
  amount numeric(12, 2) not null,
  contribution_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index savings_contributions_goal_date_idx on public.savings_contributions (savings_goal_id, contribution_date);

alter table public.savings_contributions enable row level security;

create policy "savings_contributions_owner" on public.savings_contributions
  for all using (
    exists (
      select 1 from public.savings_goals g
      where g.id = savings_goal_id and g.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.savings_goals g
      where g.id = savings_goal_id and g.user_id = auth.uid()
    )
  );

create function public.recalculate_savings_goal_balance()
returns trigger
language plpgsql
as $$
declare
  target_goal_id uuid := coalesce(new.savings_goal_id, old.savings_goal_id);
begin
  update public.savings_goals
  set current_amount = (
    select coalesce(sum(amount), 0)
    from public.savings_contributions
    where savings_goal_id = target_goal_id
  )
  where id = target_goal_id;
  return null;
end;
$$;

create trigger recalculate_savings_goal_balance
  after insert or update or delete on public.savings_contributions
  for each row execute function public.recalculate_savings_goal_balance();

-- ---------------------------------------------------------------------------
-- debts + debt_payments
-- Same derived-balance pattern as savings: current_balance always equals
-- original_amount minus the payments ledger below.
-- ---------------------------------------------------------------------------
create table public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  debt_type text not null check (debt_type in ('student_loan', 'car_loan', 'mortgage', 'other')),
  original_amount numeric(12, 2) not null check (original_amount >= 0),
  current_balance numeric(12, 2) not null default 0,
  interest_rate numeric(5, 2),
  monthly_payment numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index debts_user_id_idx on public.debts (user_id);

alter table public.debts enable row level security;

create policy "debts_owner" on public.debts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger set_debts_updated_at
  before update on public.debts
  for each row execute function public.set_updated_at();

-- New debts start with no payments yet, so balance = original amount.
create function public.initialize_debt_balance()
returns trigger
language plpgsql
as $$
begin
  new.current_balance := new.original_amount;
  return new;
end;
$$;

create trigger initialize_debt_balance
  before insert on public.debts
  for each row execute function public.initialize_debt_balance();

-- If the original amount is edited later, re-derive the balance from
-- whatever payments already exist rather than leaving it stale.
create function public.recalculate_debt_balance_on_original_change()
returns trigger
language plpgsql
as $$
begin
  if new.original_amount is distinct from old.original_amount then
    new.current_balance := new.original_amount - (
      select coalesce(sum(amount), 0)
      from public.debt_payments
      where debt_id = new.id
    );
  end if;
  return new;
end;
$$;

create trigger recalculate_debt_balance_on_original_change
  before update on public.debts
  for each row execute function public.recalculate_debt_balance_on_original_change();

create table public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  payment_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index debt_payments_debt_date_idx on public.debt_payments (debt_id, payment_date);

alter table public.debt_payments enable row level security;

create policy "debt_payments_owner" on public.debt_payments
  for all using (
    exists (
      select 1 from public.debts d
      where d.id = debt_id and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.debts d
      where d.id = debt_id and d.user_id = auth.uid()
    )
  );

create function public.recalculate_debt_balance()
returns trigger
language plpgsql
as $$
declare
  target_debt_id uuid := coalesce(new.debt_id, old.debt_id);
begin
  update public.debts
  set current_balance = original_amount - (
    select coalesce(sum(amount), 0)
    from public.debt_payments
    where debt_id = target_debt_id
  )
  where id = target_debt_id;
  return null;
end;
$$;

create trigger recalculate_debt_balance
  after insert or update or delete on public.debt_payments
  for each row execute function public.recalculate_debt_balance();
