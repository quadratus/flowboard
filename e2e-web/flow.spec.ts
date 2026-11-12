import { expect, test, type Page } from "@playwright/test";

/**
 * Spec §8 frontend scenarios against the seeded stack:
 *   required: select list → see expected kanban columns → open task → edit a custom field → save
 *   bonus:    switch user Alice → Bob → a private list disappears
 */

async function actAs(page: Page, handle: "alice" | "bob" | "carol") {
  await page.goto("/");
  await page.evaluate((h) => localStorage.setItem("flowboard.user", h), handle);
  await page.goto("/");
  await expect(page.getByTestId("tree")).toBeVisible();
}

const columnNames = (page: Page) => page.locator("[data-testid^=column-] .column-name");

test("select a list, see its columns, open a task, edit a custom field and save", async ({
  page,
}) => {
  await actAs(page, "alice");

  // Sibling lists in one folder show different columns.
  await page.getByRole("link", { name: "Backlog" }).click();
  await expect(page.getByTestId("list-title")).toHaveText("Backlog");
  await expect(columnNames(page)).toHaveText(["To do", "In progress", "Shipped"]);

  await page.getByRole("link", { name: "Sprint" }).click();
  await expect(page.getByTestId("list-title")).toHaveText("Sprint");
  await expect(columnNames(page)).toHaveText([
    "To do",
    "In progress",
    "In review",
    "Blocked",
    "Shipped",
  ]);
  await expect(page.getByTestId("lineage-blocked")).toHaveText("this list");
  await expect(page.getByTestId("lineage-done")).toHaveText("from Q2 Launch");

  // Open a card and change a custom field.
  await page.getByTestId("card").filter({ hasText: "Cursor pagination for tasks" }).click();
  const drawer = page.getByTestId("task-drawer");
  await expect(drawer).toBeVisible();
  const estimate = drawer.getByTestId("field-estimate");
  const next = String(Number(await estimate.inputValue()) + 1);

  // A required field cannot be cleared: the API answer shows under the input.
  await estimate.fill("");
  await drawer.getByTestId("save-task").click();
  await expect(drawer.locator(".field-error")).toHaveText("is required");

  await estimate.fill(next);
  await drawer.getByTestId("save-task").click();
  await expect(drawer.getByRole("status")).toHaveText("Saved");

  // The value survives a reload, so the server stored it.
  await page.reload();
  await expect(page.getByTestId("task-drawer").getByTestId("field-estimate")).toHaveValue(next);
});

test("a private list disappears when the user switches from Alice to Bob", async ({ page }) => {
  await actAs(page, "alice");
  const tree = page.getByTestId("tree");
  await expect(tree.getByText("Pipeline")).toBeVisible();
  await expect(tree.getByText("Leadership")).toBeVisible();

  await page.getByTestId("user-switcher").selectOption("bob");
  await expect(tree.getByRole("link", { name: "Backlog" })).toBeVisible();
  await expect(tree.getByText("Pipeline")).toHaveCount(0);
  await expect(tree.getByText("Leadership")).toHaveCount(0);
  await expect(tree.getByText("Sprint")).toHaveCount(0); // denied for Bob

  // A direct link to a hidden list shows the 403 with a direction, not a blank page.
  await actAs(page, "alice");
  await page.getByRole("link", { name: "Pipeline" }).click();
  const url = page.url();
  await actAs(page, "bob");
  await page.goto(url);
  await expect(page.getByRole("alert")).toContainText("You do not have access");
});
