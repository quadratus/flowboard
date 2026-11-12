import type { User } from "../api/types.ts";

/** Initials, because the mock users have no pictures. The full names are in the title. */
export function Avatars({ ids, users }: { ids: string[]; users: User[] }) {
  if (ids.length === 0) return null;
  const people = ids.map((id) => users.find((u) => u.id === id)).filter((u): u is User => !!u);
  return (
    <span className="avatars" title={people.map((u) => u.name).join(", ")}>
      {people.map((u) => (
        <span key={u.id} className={`avatar avatar-${u.handle}`} aria-label={u.name}>
          {u.name[0]}
        </span>
      ))}
    </span>
  );
}
