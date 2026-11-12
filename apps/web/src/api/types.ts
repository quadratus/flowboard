/** Shapes the API returns. They mirror apps/api routes; keep both in step. */

export type Role = "admin" | "member";
export type User = { id: string; handle: string; name: string; role: Role };

export type ContainerType = "workspace" | "space" | "folder" | "list";
export type Container = {
  id: string;
  type: ContainerType;
  parentId: string | null;
  name: string;
  position: string;
  isPrivate: boolean;
};

export type Category = "not_started" | "active" | "done" | "closed";
export type Status = {
  id: string;
  key: string;
  name: string;
  category: Category;
  color: string;
  position: string;
  ownerId: string;
  inherited: boolean;
};
export type LocalStatus = {
  id: string;
  key: string;
  hidden: boolean;
  name: string | null;
  category: Category | null;
  color: string | null;
  position: string | null;
};

export type FieldType = "text" | "number" | "single_select" | "multi_select" | "date" | "checkbox";
export type FieldOption = { id: string; label: string; color?: string };
export type Field = {
  id: string;
  key: string;
  name: string;
  type: FieldType;
  required: boolean;
  options: FieldOption[] | null;
  position: string;
  ownerId: string;
  inherited: boolean;
};

export type Priority = "urgent" | "high" | "normal" | "low" | "none";
export type FieldValue = string | number | boolean | string[];
export type Task = {
  id: string;
  listId: string;
  statusKey: string;
  title: string;
  description: string | null;
  priority: Priority;
  dueDate: string | null;
  customFields: Record<string, FieldValue>;
  position: string;
  assigneeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type Page<T> = { data: T[]; nextCursor: string | null };
export type Issue = { path: string; issue: string };
