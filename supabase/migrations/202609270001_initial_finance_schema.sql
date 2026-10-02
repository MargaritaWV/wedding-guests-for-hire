-- Friends Included finance system: Stage 1 schema
-- Supabase/PostgreSQL is the source of truth. All writes will go through server-side code.

create extension if not exists pgcrypto;

create type public.employee_role as enum ('manager', 'salesperson', 'expense_reporter');
create type public.transaction_kind as enum ('sale', 'expense');
create type public.submission_origin as enum ('website', 'telegram');
create type public.project_code as enum ('A', 'B');
create type public.expense_category as enum ('Materials', 'Travel', 'Other');
create type public.allocation_target as enum ('A', 'B', 'COMPANY_OVERHEAD');
create type public.sale_status as enum ('PENDING_APPROVAL', 'APPROVED');
create type public.expense_status as enum ('AWAITING_ALLOCATION', 'ALLOCATED');
create type public.decision_kind as enum ('SALE_APPROVAL', 'EXPENSE_ALLOCATION');
create type public.sync_state as enum ('PENDING', 'SYNCED', 'FAILED');
create type public.notification_state as enum ('PENDING', 'SENT', 'FAILED', 'NOT_REQUIRED');
create type public.notification_kind as enum (
  'SALE_SUBMISSION_CONFIRMATION',
  'EXPENSE_SUBMISSION_CONFIRMATION',
  'SALE_APPROVAL_DECISION',
  'EXPENSE_ALLOCATION_DECISION'
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  role public.employee_role not null,
  sort_order smallint not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employees_code_not_blank check (btrim(code) <> ''),
  constraint employees_name_not_blank check (btrim(display_name) <> '')
);

insert into public.employees (code, display_name, role, sort_order)
values
  ('svetlana', 'Svetlana de Monte Carlo', 'manager', 1),
  ('richard', 'Richard "Call Me Dick" Darling', 'salesperson', 2),
  ('anastasia', 'Anastasia Ferrari', 'salesperson', 3),
  ('jean_claude', 'Jean-Claude Bērziņš', 'salesperson', 4),
  ('kevin', 'Kevin von Whatever', 'expense_reporter', 5)
on conflict (code) do update
set display_name = excluded.display_name,
    role = excluded.role,
    sort_order = excluded.sort_order,
    updated_at = now();

-- The manager controls this mapping. A Telegram user cannot create or change it through the bot.
create table public.telegram_employee_links (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  employee_id uuid not null references public.employees(id),
  latest_private_chat_id bigint,
  linked_by_employee_id uuid not null references public.employees(id),
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One base row gives references global uniqueness across both transaction types.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  kind public.transaction_kind not null,
  submitted_by_employee_id uuid not null references public.employees(id),
  origin public.submission_origin not null,
  origin_telegram_user_id bigint,
  origin_telegram_chat_id bigint,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_reference_not_blank check (btrim(reference) <> ''),
  constraint telegram_origin_has_ids check (
    origin <> 'telegram'
    or (origin_telegram_user_id is not null and origin_telegram_chat_id is not null)
  )
);

create unique index transactions_reference_unique_case_insensitive
  on public.transactions (lower(reference));
create index transactions_submitter_idx on public.transactions (submitted_by_employee_id, submitted_at desc);

create table public.sales (
  transaction_id uuid primary key references public.transactions(id) on delete restrict,
  customer text not null,
  project public.project_code not null,
  description text not null,
  amount_cents bigint not null,
  proposed_richard_percent smallint not null,
  proposed_anastasia_percent smallint not null,
  proposed_jean_claude_percent smallint not null,
  final_richard_percent smallint,
  final_anastasia_percent smallint,
  final_jean_claude_percent smallint,
  status public.sale_status not null default 'PENDING_APPROVAL',
  commission_pool_cents bigint not null default 0,
  richard_commission_cents bigint not null default 0,
  anastasia_commission_cents bigint not null default 0,
  jean_claude_commission_cents bigint not null default 0,
  approved_by_employee_id uuid references public.employees(id),
  approved_at timestamptz,
  manager_changed_split boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_customer_not_blank check (btrim(customer) <> ''),
  constraint sales_description_not_blank check (btrim(description) <> ''),
  constraint sales_amount_positive check (amount_cents > 0),
  constraint sales_proposed_percent_ranges check (
    proposed_richard_percent between 0 and 100
    and proposed_anastasia_percent between 0 and 100
    and proposed_jean_claude_percent between 0 and 100
  ),
  constraint sales_proposed_percent_total check (
    proposed_richard_percent + proposed_anastasia_percent + proposed_jean_claude_percent = 100
  ),
  constraint sales_final_percent_ranges check (
    (final_richard_percent is null and final_anastasia_percent is null and final_jean_claude_percent is null)
    or (
      final_richard_percent between 0 and 100
      and final_anastasia_percent between 0 and 100
      and final_jean_claude_percent between 0 and 100
    )
  ),
  constraint sales_commission_nonnegative check (
    commission_pool_cents >= 0
    and richard_commission_cents >= 0
    and anastasia_commission_cents >= 0
    and jean_claude_commission_cents >= 0
  ),
  constraint sales_status_fields_consistent check (
    (
      status = 'PENDING_APPROVAL'
      and final_richard_percent is null
      and final_anastasia_percent is null
      and final_jean_claude_percent is null
      and approved_by_employee_id is null
      and approved_at is null
      and commission_pool_cents = 0
      and richard_commission_cents = 0
      and anastasia_commission_cents = 0
      and jean_claude_commission_cents = 0
    )
    or (
      status = 'APPROVED'
      and final_richard_percent is not null
      and final_anastasia_percent is not null
      and final_jean_claude_percent is not null
      and final_richard_percent + final_anastasia_percent + final_jean_claude_percent = 100
      and approved_by_employee_id is not null
      and approved_at is not null
      and commission_pool_cents = richard_commission_cents + anastasia_commission_cents + jean_claude_commission_cents
    )
  )
);

create index sales_status_project_idx on public.sales (status, project);

create table public.expenses (
  transaction_id uuid primary key references public.transactions(id) on delete restrict,
  description text not null,
  category public.expense_category not null,
  amount_cents bigint not null,
  proposed_allocation public.allocation_target not null,
  final_allocation public.allocation_target,
  status public.expense_status not null,
  allocated_by_employee_id uuid references public.employees(id),
  allocated_at timestamptz,
  allocation_was_automatic boolean not null default false,
  manager_changed_allocation boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_description_not_blank check (btrim(description) <> ''),
  constraint expenses_amount_positive check (amount_cents > 0),
  constraint expenses_status_fields_consistent check (
    (
      status = 'AWAITING_ALLOCATION'
      and proposed_allocation in ('A', 'B')
      and final_allocation is null
      and allocated_by_employee_id is null
      and allocated_at is null
      and allocation_was_automatic = false
    )
    or (
      status = 'ALLOCATED'
      and final_allocation is not null
      and allocated_at is not null
      and (
        (allocation_was_automatic = true and proposed_allocation = 'COMPANY_OVERHEAD' and final_allocation = 'COMPANY_OVERHEAD' and allocated_by_employee_id is null)
        or (allocation_was_automatic = false and allocated_by_employee_id is not null)
      )
    )
  )
);

create index expenses_status_allocation_idx on public.expenses (status, final_allocation);

-- One decision row per transaction makes approvals idempotent and keeps an audit snapshot.
create table public.manager_decisions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  kind public.decision_kind not null,
  manager_employee_id uuid not null references public.employees(id),
  original_proposal jsonb not null,
  final_decision jsonb not null,
  manager_changed_proposal boolean not null,
  decided_at timestamptz not null default now()
);

-- One job is reused for create, decision update, and retry. Workers upsert by reference.
create table public.google_sheet_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions(id) on delete cascade,
  sheet_tab text not null check (sheet_tab in ('Sales', 'Expenses')),
  state public.sync_state not null default 'PENDING',
  row_number integer check (row_number is null or row_number > 1),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  synced_at timestamptz,
  next_retry_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index google_sheet_sync_state_idx
  on public.google_sheet_sync_jobs (state, next_retry_at, updated_at);

-- Financial approval remains saved even when a delivery job fails.
create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  kind public.notification_kind not null,
  destination_chat_id bigint,
  state public.notification_state not null default 'PENDING',
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  next_retry_at timestamptz,
  last_error text,
  not_required_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_delivery_fields_consistent check (
    (state = 'SENT' and destination_chat_id is not null and sent_at is not null)
    or (state = 'NOT_REQUIRED' and sent_at is null and not_required_reason is not null)
    or (state in ('PENDING', 'FAILED') and sent_at is null)
  ),
  unique (transaction_id, kind)
);

create index notification_jobs_state_idx
  on public.notification_jobs (state, next_retry_at, updated_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger employees_set_updated_at before update on public.employees
for each row execute function public.set_updated_at();
create trigger telegram_links_set_updated_at before update on public.telegram_employee_links
for each row execute function public.set_updated_at();
create trigger transactions_set_updated_at before update on public.transactions
for each row execute function public.set_updated_at();
create trigger sales_set_updated_at before update on public.sales
for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at before update on public.expenses
for each row execute function public.set_updated_at();
create trigger google_sync_set_updated_at before update on public.google_sheet_sync_jobs
for each row execute function public.set_updated_at();
create trigger notification_jobs_set_updated_at before update on public.notification_jobs
for each row execute function public.set_updated_at();

-- No browser role receives table access. The Next.js server uses the service role only.
alter table public.employees enable row level security;
alter table public.telegram_employee_links enable row level security;
alter table public.transactions enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;
alter table public.manager_decisions enable row level security;
alter table public.google_sheet_sync_jobs enable row level security;
alter table public.notification_jobs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
