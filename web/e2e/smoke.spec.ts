import { expect, test } from "@playwright/test";

test("home page is server-rendered", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('<html lang="ko">');
  expect(html).toContain("SNU Archive");
});

test("home page hydrates without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("main")).toHaveText("SNU Archive");
  expect(errors).toEqual([]);
});
