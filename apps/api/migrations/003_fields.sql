-- 003: custom field definitions. Values live in tasks.custom_fields (migration 004).
-- Scoping: a definition on a container applies to every list below it.
-- Collisions are explicit: a key must be unique on each root-to-list path (API checks it, 409).

create table field_definitions (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references containers(id),
  key         text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  name        text not null check (length(name) between 1 and 100),
  type        text not null check (type in
                ('text', 'number', 'single_select', 'multi_select', 'date', 'checkbox')),
  required    boolean not null default false,
  options     jsonb,                         -- [{ id, label, color? }] for select types only
  position    text collate "C" not null,
  archived_at timestamptz,                   -- archived = hidden from the schema, values kept

  unique (owner_id, key),
  check ((type in ('single_select', 'multi_select')) = (options is not null)),
  check (options is null or jsonb_typeof(options) = 'array')
);

-- The field schema for a container: active definitions on the container and all ancestors.
-- No collision handling here: the write path guarantees one definition per key on a path.
create function resolved_fields(p_container uuid)
returns table (id uuid, key text, name text, type text, required boolean,
               options jsonb, "position" text, owner_id uuid, depth int)
language sql stable
as $$
  select f.id, f.key, f.name, f.type, f.required, f.options, f.position, f.owner_id, a.depth
  from ancestors(p_container) a
  join field_definitions f on f.owner_id = a.id
  where f.archived_at is null
  order by f.position, f.key
$$;
