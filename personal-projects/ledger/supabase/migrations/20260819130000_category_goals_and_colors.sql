-- Categories gain an explicit income/expense type, a per-category monthly
-- goal (renamed from monthly_budget now that it applies to income targets
-- too, not just spending caps), and a user-chosen display color.

alter table public.categories
  add column category_type text not null check (category_type in ('income', 'expense'));

alter table public.categories
  rename column monthly_budget to monthly_goal;

alter table public.categories
  add column color text not null check (color ~ '^#[0-9a-fA-F]{6}$');

-- A transaction's type must match its category's type, so a category's
-- goal-tracking math (spent-vs-goal, earned-vs-goal) never gets corrupted
-- by a mismatched transaction.
create function public.validate_transaction_category_type()
returns trigger
language plpgsql
as $$
declare
  cat_type text;
begin
  if new.category_id is not null then
    select category_type into cat_type from public.categories where id = new.category_id;
    if cat_type is distinct from new.type then
      raise exception 'transaction type (%) does not match category type (%)', new.type, cat_type;
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_transaction_category_type
  before insert or update on public.transactions
  for each row execute function public.validate_transaction_category_type();

-- Subscriptions are inherently expenses, so any linked category must be
-- an expense category too.
create function public.validate_subscription_category_type()
returns trigger
language plpgsql
as $$
declare
  cat_type text;
begin
  if new.category_id is not null then
    select category_type into cat_type from public.categories where id = new.category_id;
    if cat_type is distinct from 'expense' then
      raise exception 'subscription category must be an expense category';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_subscription_category_type
  before insert or update on public.subscriptions
  for each row execute function public.validate_subscription_category_type();
