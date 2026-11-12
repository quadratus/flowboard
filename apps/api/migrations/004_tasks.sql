-- 004: tasks and assignees.

create table tasks (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references containers(id),  -- "primaryListId"; type checked in the API
  -- A key, not a foreign key: overrides on lower levels are new rows with new ids,
  -- but the key stays the same. The API checks it against resolved_statuses(list_id).
  status_key    text not null,
  title         text not null check (length(title) between 1 and 500),
  description   text check (length(description) <= 20000),
  priority      text not null default 'none'
                check (priority in ('urgent', 'high', 'normal', 'low', 'none')),
  due_date      timestamptz,
  custom_fields jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object'),
  position      text collate "C" not null,                -- order inside its status column
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Board load: one list, grouped by status, in order.
create index tasks_board on tasks (list_id, status_key, position);
-- Config safety: "which tasks still use status key X?"
create index tasks_status_key on tasks (status_key);

create table task_assignees (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (task_id, user_id)
);
create index task_assignees_user on task_assignees (user_id);

-- Tasks whose status key is not in the resolved set of their list.
-- The "no orphan board state" invariant: this must always return 0 rows.
create function orphan_tasks(p_root uuid default null)
returns table (task_id uuid, list_id uuid, status_key text)
language sql stable
as $$
  select t.id, t.list_id, t.status_key
  from tasks t
  where (p_root is null or exists (select 1 from ancestors(t.list_id) a where a.id = p_root))
    and not exists (
      select 1 from resolved_statuses(t.list_id) r where r.key = t.status_key
    )
$$;
