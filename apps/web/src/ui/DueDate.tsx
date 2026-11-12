const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY = 86_400_000;

/** Whole calendar days from today to the date, in local time: 0 = today, -1 = yesterday. */
function daysFromToday(date: Date) {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(date) - startOf(new Date())) / DAY);
}

/** Short date. Overdue dates stand out, because that is the reason to show a date on a card. */
export function DueDate({ iso }: { iso: string }) {
  const date = new Date(iso);
  const days = daysFromToday(date);
  const state = days < 0 ? "overdue" : days <= 2 ? "soon" : "later";
  return (
    <time className={`due due-${state}`} dateTime={iso} title={date.toLocaleString()}>
      {days === 0 ? "Today" : fmt.format(date)}
      {state === "overdue" ? <span className="due-flag">overdue</span> : null}
    </time>
  );
}
