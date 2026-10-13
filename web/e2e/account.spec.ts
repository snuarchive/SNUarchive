import { expect, test } from "@playwright/test";

import { ACCOUNTS, expectToast, resetData, signIn } from "./helpers";
import { TARGET } from "./origins";

test.beforeEach(async ({ request }) => {
  await resetData(request);
});

test("the profile banner saves and disappears", async ({ page }) => {
  await signIn(page, ACCOUNTS.newbie);
  const banner = page.getByText("학과 통계에 참여해보세요");
  await expect(banner).toBeVisible();
  await page.getByLabel("단과대학").selectOption({ index: 1 });
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expectToast(page, "저장되었습니다. 감사합니다!");
  await expect(banner).toHaveCount(0);
});

test("the profile banner can be put off for the session", async ({ page }) => {
  await signIn(page, ACCOUNTS.newbie);
  await page.getByRole("button", { name: "나중에" }).click();
  await expect(page.getByText("학과 통계에 참여해보세요")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("학과 통계에 참여해보세요")).toHaveCount(0);
});

test("deleting the account needs the confirmation page", async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await page.goto("/me");
  await page.getByRole("link", { name: "탈퇴하기" }).click();
  await expect(
    page.getByRole("heading", { name: "정말 탈퇴할까요?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "탈퇴", exact: true }).click();
  await expectToast(page, "탈퇴했습니다.");
  await expect(
    page.getByRole("link", { name: "Google로 로그인" }),
  ).toBeVisible();
});

test("logout on every device signs this browser out too", async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await page.goto("/me");
  await page.getByRole("button", { name: "모든 기기에서 로그아웃" }).click();
  await expect(
    page.getByRole("link", { name: "Google로 로그인" }),
  ).toBeVisible();
});

test("Google sign-in returns to the page it started from", async ({ page }) => {
  test.skip(TARGET !== "mock", "uses the mock's stand-in for Google");
  await page.goto("/me");
  await page.getByRole("link", { name: "Google로 로그인" }).click();
  await page.getByRole("link", { name: ACCOUNTS.student }).click();
  await expectToast(page, "로그인되었습니다.");
  await expect(page).toHaveURL("/me");
});

test("dev sign-in returns to the page it started from", async ({ page }) => {
  await page.goto("/admin/logs/entries?action=login");
  await page.getByPlaceholder("student@snu.ac.kr").fill(ACCOUNTS.admin);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expectToast(page, "로그인되었습니다.");
  await expect(page).toHaveURL("/admin/logs/entries?action=login");
});

test.describe("favourites order on /me", () => {
  const titles = (page: import("@playwright/test").Page) =>
    page.locator("#favorites li strong").allInnerTexts();

  test("the ↓ button moves a favourite and the home list follows", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.student);
    await page.getByRole("link", { name: "모두 보기 · 순서 바꾸기" }).click();
    await expect(page).toHaveURL(/\/me#favorites$/);
    const before = await titles(page);
    expect(before.length).toBeGreaterThan(1);

    await page.getByRole("button", { name: `${before[0]} 아래로` }).click();
    await expect
      .poll(() => titles(page))
      .toEqual([before[1], before[0], ...before.slice(2)]);

    await page.goto("/archive");
    const home = page.getByRole("region", { name: "즐겨찾기" });
    await expect(home.locator("article strong").first()).toHaveText(before[1]);
  });

  test("rows can be dragged", async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await page.goto("/me");
    const before = await titles(page);
    const rows = page.locator("#favorites li");
    await rows.nth(0).dragTo(rows.nth(2));
    await expect
      .poll(() => titles(page))
      .toEqual([before[1], before[2], before[0], ...before.slice(3)]);
    await page.reload();
    expect(await titles(page)).toEqual([
      before[1],
      before[2],
      before[0],
      ...before.slice(3),
    ]);
  });

  test("the buttons work without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await signIn(page, ACCOUNTS.student);
    await page.goto("/me");
    const before = await titles(page);
    await page.getByRole("button", { name: `${before[1]} 위로` }).click();
    expect(await titles(page)).toEqual([
      before[1],
      before[0],
      ...before.slice(2),
    ]);
    await context.close();
  });
});
