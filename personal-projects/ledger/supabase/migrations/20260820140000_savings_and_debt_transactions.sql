-- Savings goals and debts get free-text notes, and their transaction ledgers
-- become two-directional (deposit/withdrawal, reduce/extend) instead of only
-- ever moving balance one way. Both structured-field sets that the UI never
-- ends up asking for (goal_type, debt_type/interest_rate/monthly_payment)
-- are relaxed rather than dropped, same as category_type earlier.

alter table public.savings_goals
  add column notes text;

alter table public.savings_goals
  alter column goal_type set default 'want';

alter table public.debts
  add column notes text;

alter table public.debts
  alter column debt_type drop not null;

-- ---------------------------------------------------------------------------
-- savings_contributions: add direction, recompute balance as a signed sum
-- ---------------------------------------------------------------------------
alter table public.savings_contributions
  add column type text not null check (type in ('deposit', 'withdrawal'));

alter table public.savings_contributions
  add constraint savings_contributions_amount_positive check (amount > 0);

create or replace function public.recalculate_savings_goal_balance()
returns trigger
language plpgsql
as $$
declare
  target_goal_id uuid := coalesce(new.savings_goal_id, old.savings_goal_id);
begin
  update public.savings_goals
  set current_amount = (
    select coalesce(sum(case when type = 'deposit' then amount else -amount end), 0)
    from public.savings_contributions
    where savings_goal_id = target_goal_id
  )
  where id = target_goal_id;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- debt_payments: add direction, recompute balance as a signed sum
-- ---------------------------------------------------------------------------
alter table public.debt_payments
  add column type text not null check (type in ('reduce', 'extend'));

create or replace function public.recalculate_debt_balance()
returns trigger
language plpgsql
as $$
declare
  target_debt_id uuid := coalesce(new.debt_id, old.debt_id);
begin
  update public.debts
  set current_balance = original_amount - (
    select coalesce(sum(case when type = 'reduce' then amount else -amount end), 0)
    from public.debt_payments
    where debt_id = target_debt_id
  )
  where id = target_debt_id;
  return null;
end;
$$;

create or replace function public.recalculate_debt_balance_on_original_change()
returns trigger
language plpgsql
as $$
begin
  if new.original_amount is distinct from old.original_amount then
    new.current_balance := new.original_amount - (
      select coalesce(sum(case when type = 'reduce' then amount else -amount end), 0)
      from public.debt_payments
      where debt_id = new.id
    );
  end if;
  return new;
end;
$$;
