import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import { generateKeyBetween } from "fractional-indexing";
import { useState } from "react";
import { keys, useUpdateTask } from "../../api/queries.ts";
import type { Container, Field, Status, Task, User } from "../../api/types.ts";
import { ownerLabel } from "../../lib/tree.ts";
import { ErrorNote } from "../../ui/ErrorNote.tsx";
import { Card } from "./Card.tsx";

type Props = {
  listId: string;
  tasks: Task[];
  statuses: Status[];
  fields: Field[];
  users: User[];
  tree: Container[];
  onOpen: (id: string) => void;
};

const byPosition = (a: Task, b: Task) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/**
 * Columns = the resolved statuses of the list. A drop sends one PATCH with the new column and
 * the neighbour below the drop point; the server computes the position key.
 * The cache changes first (optimistic), and a failed PATCH restores it and shows the reason.
 */
export function Board({ listId, tasks, statuses, fields, users, tree, onOpen }: Props) {
  const qc = useQueryClient();
  const update = useUpdateTask(listId);
  const [dragging, setDragging] = useState<Task | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // a click still opens the card
    useSensor(KeyboardSensor, { coordinateGetter: (event, args) => keyboardTarget(event, args) }),
  );

  const columns = statuses.map((s) => ({
    status: s,
    cards: tasks.filter((t) => t.statusKey === s.key).sort(byPosition),
  }));
  const badgeField = fields.find((f) => f.type === "single_select");

  /**
   * Left and right jump to the next column (its first card, or its empty area). The sortable
   * default compares box edges, and each column's drop area starts 2px left of its cards, so
   * "left" kept finding the current column. Up and down keep the sortable default.
   */
  const keyboardTarget: KeyboardCoordinateGetter = (event, args) => {
    if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") {
      return sortableKeyboardCoordinates(event, args);
    }
    event.preventDefault();
    const { active, over, droppableRects } = args.context;
    const overId = String(over?.id ?? active?.id ?? "");
    const currentKey = tasks.find((t) => t.id === overId)?.statusKey ?? overId.replace(/^col:/, "");
    const next =
      columns[
        columns.findIndex((c) => c.status.key === currentKey) +
          (event.code === "ArrowRight" ? 1 : -1)
      ];
    if (!next) return undefined;
    const firstCard = next.cards.find((t) => t.id !== active?.id);
    const rect = droppableRects.get(firstCard?.id ?? `col:${next.status.key}`);
    return rect ? { x: rect.left, y: rect.top } : undefined;
  };

  // Screen-reader messages in words: dnd-kit's defaults read the raw task and column ids.
  const title = (id: string | number) => tasks.find((t) => t.id === id)?.title ?? "the card";
  const place = (id: string | number | undefined) => {
    if (id === undefined) return "no column";
    const card = tasks.find((t) => t.id === id);
    const key = card?.statusKey ?? String(id).replace(/^col:/, "");
    const column = statuses.find((s) => s.key === key)?.name ?? key;
    return card ? `${column}, at ${card.title}` : column;
  };
  const accessibility = {
    screenReaderInstructions: {
      draggable:
        "Press space to pick up the card. Use the arrow keys to move it, space to drop it, and escape to cancel. Press enter to open it.",
    },
    announcements: {
      onDragStart: ({ active }: { active: { id: string | number } }) =>
        `Picked up ${title(active.id)}.`,
      onDragOver: ({
        active,
        over,
      }: {
        active: { id: string | number };
        over: { id: string | number } | null;
      }) => `${title(active.id)} is over ${place(over?.id)}.`,
      onDragEnd: ({
        active,
        over,
      }: {
        active: { id: string | number };
        over: { id: string | number } | null;
      }) =>
        over
          ? `Dropped ${title(active.id)} in ${place(over.id)}.`
          : `${title(active.id)} returned to its place.`,
      onDragCancel: ({ active }: { active: { id: string | number } }) =>
        `Move cancelled. ${title(active.id)} returned to its place.`,
    },
  };

  function onDragStart(e: DragStartEvent) {
    setDragging(tasks.find((t) => t.id === e.active.id) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const card = tasks.find((t) => t.id === e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!card || !overId || overId === card.id) return;

    // The drop target is a column's empty area ("col:<key>") or a card inside a column.
    const overCard = tasks.find((t) => t.id === overId);
    const target = overCard?.statusKey ?? statuses.find((s) => `col:${s.key}` === overId)?.key;
    if (!target) return;

    // Dropped on a card: take its place. In the same column, moving down lands below the target
    // and moving up lands above it, like a sortable list. Dropped on empty space: go last.
    const column = columns.find((c) => c.status.key === target)!.cards;
    const others = column.filter((t) => t.id !== card.id);
    let i = overCard ? others.findIndex((t) => t.id === overCard.id) : others.length;
    const movingDown =
      overCard && target === card.statusKey && column.indexOf(card) < column.indexOf(overCard);
    if (movingDown) i += 1;
    const before = others[i];
    const after = others[i - 1];
    if (target === card.statusKey && before?.id === nextInColumn(card)) return; // no change

    // Optimistic: the same key function as the server, so the card lands where it will stay.
    const position = generateKeyBetween(after?.position ?? null, before?.position ?? null);
    const previous = qc.getQueryData<Task[]>(keys.tasks(listId));
    qc.setQueryData<Task[]>(keys.tasks(listId), (all) =>
      all?.map((t) => (t.id === card.id ? { ...t, statusKey: target, position } : t)),
    );
    update.mutate(
      {
        id: card.id,
        patch: {
          statusKey: target,
          ...(before ? { beforeId: before.id } : after ? { afterId: after.id } : {}),
        },
      },
      { onError: () => qc.setQueryData(keys.tasks(listId), previous) },
    );
  }

  function nextInColumn(card: Task) {
    const cards = columns.find((c) => c.status.key === card.statusKey)!.cards;
    return cards[cards.findIndex((t) => t.id === card.id) + 1]?.id;
  }

  return (
    <>
      {update.error ? <ErrorNote error={update.error} /> : null}
      <DndContext
        accessibility={accessibility}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="board" data-testid="board">
          {columns.map(({ status, cards }) => (
            <Column
              key={status.key}
              status={status}
              lineage={ownerLabel(tree, status.ownerId, listId)}
              count={cards.length}
            >
              <SortableContext
                items={cards.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {cards.map((t) => (
                  <SortableCard
                    key={t.id}
                    task={t}
                    users={users}
                    badgeField={badgeField}
                    onOpen={onOpen}
                  />
                ))}
              </SortableContext>
            </Column>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? <Card task={dragging} users={users} badgeField={badgeField} lifted /> : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function Column({
  status,
  lineage,
  count,
  children,
}: {
  status: Status;
  lineage: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status.key}` });
  return (
    <section
      className={`column${isOver ? " is-over" : ""}`}
      aria-label={status.name}
      data-testid={`column-${status.key}`}
    >
      <header className="column-head">
        <span className="lamp" style={{ background: status.color }} aria-hidden="true" />
        <h2 className="column-name">{status.name}</h2>
        <span className="column-count">{count}</span>
        <p className="lineage" data-testid={`lineage-${status.key}`}>
          {lineage}
        </p>
      </header>
      <div ref={setNodeRef} className="column-body">
        {children}
        {count === 0 ? <p className="column-empty">Drop a card here</p> : null}
      </div>
    </section>
  );
}

function SortableCard({
  task,
  users,
  badgeField,
  onOpen,
}: {
  task: Task;
  users: User[];
  badgeField?: Field;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "card-slot is-placeholder" : "card-slot"}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) onOpen(task.id);
      }}
      aria-roledescription="draggable card"
    >
      <Card task={task} users={users} badgeField={badgeField} />
    </div>
  );
}
