import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./client.ts";
import type { Container, Field, LocalStatus, Page, Status, Task, User } from "./types.ts";

type Data<T> = { data: T[] };

export const keys = {
  me: ["me"] as const,
  users: ["users"] as const,
  tree: ["tree"] as const,
  container: (id: string) => ["container", id] as const,
  statuses: (id: string) => ["statuses", id] as const,
  localStatuses: (id: string) => ["local-statuses", id] as const,
  fields: (id: string) => ["fields", id] as const,
  localFields: (id: string) => ["local-fields", id] as const,
  tasks: (listId: string) => ["tasks", listId] as const,
  task: (id: string) => ["task", id] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api<User>("GET", "/me") });
export const useUsers = () =>
  useQuery({
    queryKey: keys.users,
    queryFn: () => api<Data<User>>("GET", "/users"),
    select: (r) => r.data,
  });
export const useTree = () =>
  useQuery({
    queryKey: keys.tree,
    queryFn: () => api<Data<Container>>("GET", "/tree"),
    select: (r) => r.data,
  });

/** Resolved set for a container. Pass null to skip (for example the parent of the workspace). */
export const useStatuses = (containerId: string | null) =>
  useQuery({
    queryKey: keys.statuses(containerId ?? ""),
    queryFn: () => api<Data<Status>>("GET", `/containers/${containerId}/resolved-statuses`),
    select: (r) => r.data,
    enabled: !!containerId,
  });
export const useLocalStatuses = (containerId: string) =>
  useQuery({
    queryKey: keys.localStatuses(containerId),
    queryFn: () => api<Data<LocalStatus>>("GET", `/containers/${containerId}/statuses`),
    select: (r) => r.data,
  });
export const useFields = (containerId: string) =>
  useQuery({
    queryKey: keys.fields(containerId),
    queryFn: () => api<Data<Field>>("GET", `/containers/${containerId}/resolved-fields`),
    select: (r) => r.data,
  });

/** Every task of a list. The board needs all cards, so this walks the cursor to the end. */
async function allTasks(listId: string, sort: string): Promise<Task[]> {
  const out: Task[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ limit: "200", sort });
    if (cursor) q.set("cursor", cursor);
    const page: Page<Task> = await api<Page<Task>>("GET", `/lists/${listId}/tasks?${q}`);
    out.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export const useTasks = (listId: string) =>
  useQuery({ queryKey: keys.tasks(listId), queryFn: () => allTasks(listId, "position") });

export const useTask = (id: string | null) =>
  useQuery({
    queryKey: keys.task(id ?? ""),
    queryFn: () => api<Task>("GET", `/tasks/${id}`),
    enabled: !!id,
  });

/** After a write, refetch everything that can show the changed task or config. */
function refreshList(qc: QueryClient, listId: string) {
  void qc.invalidateQueries({ queryKey: keys.tasks(listId) });
}

export type TaskPatch = Partial<
  Pick<Task, "title" | "statusKey" | "description" | "priority" | "dueDate" | "assigneeIds">
> & {
  customFields?: Record<string, unknown>;
  afterId?: string;
  beforeId?: string;
};

export function useUpdateTask(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      api<Task>("PATCH", `/tasks/${id}`, patch),
    onSuccess: (task) => qc.setQueryData(keys.task(task.id), task),
    onSettled: () => refreshList(qc, listId),
  });
}

export function useCreateTask(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskPatch & { title: string; statusKey: string }) =>
      api<Task>("POST", `/lists/${listId}/tasks`, body),
    onSuccess: () => refreshList(qc, listId),
  });
}

export function useMoveTask(fromListId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      listId: string;
      statusKey?: string;
      customFields?: Record<string, unknown>;
    }) => api<Task & { strippedFields: string[] }>("POST", `/tasks/${id}/move`, body),
    onSuccess: (task) => {
      refreshList(qc, fromListId);
      refreshList(qc, task.listId);
      qc.setQueryData(keys.task(task.id), task);
    },
  });
}

export function useDeleteTask(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/tasks/${id}`),
    onSuccess: () => refreshList(qc, listId),
  });
}

/** Config writes can change any board below the level, so they refetch all config and tasks. */
export function useConfigMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all(
        ["statuses", "local-statuses", "fields", "local-fields", "tasks"].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      ),
  });
}
