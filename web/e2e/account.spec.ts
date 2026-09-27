import { expect, test } from "@playwright/test";

import { ACCOUNTS, expectToast, resetMock, signIn } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
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
