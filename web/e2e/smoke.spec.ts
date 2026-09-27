import { expect, test } from "@playwright/test";

import { ACCOUNTS, resetMock, signIn } from "./helpers";
import { APP_ORIGIN } from "./origins";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("signed out, every page shows the sign-in screen with 401", async ({
  request,
}) => {
  for (const path of ["/", "/courses/1", "/admin/review/reports", "/me"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(401);
    const html = await response.text();
    expect(html).toContain('<html lang="ko"');
    expect(html).toContain("Google로 로그인");
  }
});

test("unknown paths answer 404", async ({ request }) => {
  const response = await request.get("/no-such-page");
  expect(response.status()).toBe(404);
  expect(await response.text()).toContain("페이지를 찾을 수 없습니다.");
});

test("students cannot open the admin console", async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  const response = await page.goto("/admin/review/reports");
  expect(response?.status()).toBe(403);
  await expect(page.getByText("이 페이지를 볼 권한이 없습니다.")).toBeVisible();
});

test("pages hydrate and navigate without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, ACCOUNTS.admin);
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL("/admin/review/reports");
  for (const group of ["투표", "로그", "사용자", "운영", "검토"]) {
    await page
      .getByRole("navigation", { name: "관리자 메뉴" })
      .getByRole("link", { name: group })
      .click();
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  }
  await page.getByRole("link", { name: "Archive", exact: true }).click();
  await expect(page).toHaveURL("/");
  expect(errors).toEqual([]);
});

test("admin actions refuse non-admins before reaching the API", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.student);
  const posts: [string, Record<string, string>][] = [
    ["/admin/users/lookup", { userId: "2" }],
    ["/admin/logs/clear", {}],
    ["/admin/review/comments", { commentId: "1" }],
  ];
  for (const [path, form] of posts) {
    const response = await page.request.post(path, {
      form,
      headers: { Origin: APP_ORIGIN },
      maxRedirects: 0,
    });
    expect(response.status(), path).toBe(403);
  }
});
