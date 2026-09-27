import { expect, test } from "@playwright/test";

const pages = [
  "/",
  "/courses/sample",
  "/admin/reports",
  "/admin/stats",
  "/admin/logs",
  "/admin/colleges",
];

for (const path of pages) {
  test(`${path} is server-rendered`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain("SNU Archive");
  });
}

test("/admin redirects to the report queue", async ({ request }) => {
  const response = await request.get("/admin", { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toBe("/admin/reports");
});

test("unknown paths answer 404 and keep the navigation", async ({
  request,
}) => {
  const response = await request.get("/no-such-page");
  expect(response.status()).toBe(404);
  const html = await response.text();
  expect(html).toContain("페이지를 찾을 수 없습니다.");
  expect(html).toContain('aria-label="보기 전환"');
});

test("searching without JavaScript keeps the open course", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/courses/sample");
  await page.getByRole("searchbox").fill("미적분");
  await page.getByRole("searchbox").press("Enter");
  await expect(page).toHaveURL(/\/courses\/sample\?q=/);
  await expect(page.getByRole("searchbox")).toHaveValue("미적분");
  await context.close();
});

test("pages hydrate and navigate without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/admin/reports");
  await page.getByRole("link", { name: "로그 보기" }).click();
  await expect(page).toHaveURL("/admin/logs");
  await expect(page.getByRole("heading", { name: "로그 보기" })).toBeVisible();
  await page.getByRole("link", { name: "Archive" }).click();
  await expect(page).toHaveURL("/");
  expect(errors).toEqual([]);
});
