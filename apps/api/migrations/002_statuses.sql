-- 002: scoped statuses. Model: merge by key, nearest level wins (docs/PLAN.md §0).

create table statuses (
  id        uuid primary key default gen_random_uuid(),
  owner_id  uuid not null references containers(id),
  key       text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  hidden    boolean not null default false, -- a "tombstone": hides the inherited key at this level
  name      text check (length(name) between 1 and 50),
  category  text check (category in ('not_started', 'active', 'done', 'closed')),
  color     text check (color ~ '^#[0-9a-f]{6}$'),
  position  text collate "C",               -- fractional key, shared by all levels

  unique (owner_id, key),                   -- one row per key on each level
  -- A hide row needs only owner and key. Every other row is a full definition.
  check (hidden or (name is not null and category is not null
                    and color is not null and position is not null))
);

-- The status set that a container shows: for each key, the row from the nearest level,
-- then hidden keys removed. Works for any container, so a folder can preview its set.
-- Order matters: pick the nearest row first, then filter. Filtering first would let an
-- ancestor row win over a hide row.
create function resolved_statuses(p_container uuid)
returns table (id uuid, key text, name text, category text, color text,
               "position" text, owner_id uuid, depth int) -- quoted: position is a keyword here
language sql stable
as $$
  select n.id, n.key, n.name, n.category, n.color, n.position, n.owner_id, n.depth
  from (
    select distinct on (s.key) s.*, a.depth
    from ancestors(p_container) a
    join statuses s on s.owner_id = a.id
    order by s.key, a.depth
  ) n
  where not n.hidden
  order by n.position, n.key
$$;

-- Containers in the subtree of p_root (active only) whose resolved set lacks a required
-- category. Every resolved set needs not_started, active and done.
create function incomplete_status_sets(p_root uuid)
returns table (container_id uuid, name text, missing text[])
language sql stable
as $$
  with recursive subtree as (
    select id, name from containers where id = p_root and archived_at is null
    union all
    select c.id, c.name from containers c
    join subtree s on c.parent_id = s.id
    where c.archived_at is null
  )
  select s.id, s.name, m.missing
  from subtree s
  cross join lateral (
    select array_remove(array[
      case when not coalesce(bool_or(r.category = 'not_started'), false) then 'not_started' end,
      case when not coalesce(bool_or(r.category = 'active'), false) then 'active' end,
      case when not coalesce(bool_or(r.category = 'done'), false) then 'done' end
    ], null) as missing
    from resolved_statuses(s.id) r
  ) m
  where cardinality(m.missing) > 0
$$;
