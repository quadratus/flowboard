-- 001: users, the container tree, grants, and the access rules.

create table users (
  id     uuid primary key default gen_random_uuid(),
  handle text not null unique check (handle ~ '^[a-z][a-z0-9_]{0,39}$'), -- value of X-User-Id
  name   text not null,
  role   text not null check (role in ('admin', 'member'))
);

-- The spec calls these "nodes". One table for every level (adjacency list).
create table containers (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('workspace', 'space', 'folder', 'list')),
  parent_id   uuid references containers(id),
  name        text not null check (length(name) between 1 and 200),
  position    text collate "C" not null, -- fractional index key, compared byte by byte
  is_private  boolean not null default false,
  archived_at timestamptz,               -- null = active
  created_at  timestamptz not null default now(),

  -- Only a workspace has no parent. The parent *type* rule is checked in the API.
  check ((type = 'workspace') = (parent_id is null))
);

-- Sibling order. Archived rows leave the index, so unarchive cannot collide with them.
create unique index containers_sibling_order
  on containers (parent_id, position)
  where archived_at is null;

create table grants (
  container_id uuid not null references containers(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  mode         text not null check (mode in ('allow', 'deny')),
  primary key (container_id, user_id) -- one grant per user per container: no allow+deny conflict
);

-- The container and all its ancestors. depth 0 = the container itself.
create function ancestors(p_id uuid)
returns table (id uuid, parent_id uuid, type text, is_private boolean,
               archived_at timestamptz, depth int)
language sql stable
as $$
  with recursive a as (
    select c.id, c.parent_id, c.type, c.is_private, c.archived_at, 0 as depth
    from containers c
    where c.id = p_id

    union all

    select c.id, c.parent_id, c.type, c.is_private, c.archived_at, a.depth + 1
    from containers c
    join a on c.id = a.parent_id
    where a.depth < 10 -- guard: the tree has 4 levels, so a deeper walk means a cycle
  )
  select * from a
$$;

-- Path rule (topic 6). Returns 'ok', 'not_found' or 'forbidden'.
-- A member can see a container when no container on its path denies them,
-- and every private container on its path allows them.
create function access_check(p_user uuid, p_container uuid)
returns text
language sql stable
as $$
  with path as (select * from ancestors(p_container))
  select case
    when not exists (select 1 from path) then 'not_found'
    when exists (select 1 from path where archived_at is not null) then 'not_found'
    when (select role from users where id = p_user) = 'admin' then 'ok'
    when exists (
      select 1 from path p
      join grants g on g.container_id = p.id and g.user_id = p_user and g.mode = 'deny'
    ) then 'forbidden'
    when exists (
      select 1 from path p
      where p.is_private
        and not exists (
          select 1 from grants g
          where g.container_id = p.id and g.user_id = p_user and g.mode = 'allow'
        )
    ) then 'forbidden'
    else 'ok'
  end
$$;
