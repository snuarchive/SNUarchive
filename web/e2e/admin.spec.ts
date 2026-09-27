import { expect, test } from "@playwright/test";

import {
  ACCOUNTS,
  expectToast,
  injectFault,
  resetMock,
  signIn,
} from "./helpers";

test.beforeEach(async ({ request, page }) => {
  await resetMock(request);
  await signIn(page, ACCOUNTS.admin);
});

test("a pending upload is approved into a statistic", async ({ page }) => {
  await page.goto("/admin/review/reports");
  const card = page
    .locator("article", {
      has: page.getByRole("button", { name: "승인 등록" }),
    })
    .first();
  await expect(card.locator("img, iframe").first()).toBeVisible();
  await card.getByLabel("Q2").fill("55");
  await card.getByRole("button", { name: "승인 등록" }).click();
  await expectToast(page, "통계량으로 등록했습니다.");
});

test("voting opens from the request queue", async ({ page }) => {
  await page.goto("/admin/voting/requests");
  await page.getByRole("button", { name: "투표 열기" }).first().click();
  await expectToast(page, "투표를 열었습니다.");
});

test("a failed log load is shown as an error, not an empty list", async ({
  page,
  request,
}) => {
  await injectFault(request, {
    method: "GET",
    path: "/api/v1/admin/logs",
    status: 500,
    code: "INTERNAL",
  });
  await page.goto("/admin/logs/entries");
  await expect(page.getByRole("alert")).toContainText(
    "로그를 불러오지 못했습니다.",
  );
});

test("clearing logs goes through a confirmation page", async ({ page }) => {
  await page.goto("/admin/logs/entries");
  await page.getByRole("link", { name: "비우기" }).click();
  await expect(page).toHaveURL("/admin/logs/clear");
  await page.getByRole("button", { name: "모두 비우기" }).click();
  await expectToast(page, "로그를 비웠습니다.");
});

test("log export links carry the filter", async ({ page }) => {
  await page.goto("/admin/logs/entries?action=login");
  const csv = page.getByRole("link", { name: "CSV로 내보내기" });
  await expect(csv).toHaveAttribute("href", /format=csv/);
  await expect(csv).toHaveAttribute("href", /action=login/);
});

test("statistics can be hidden and restored", async ({ page }) => {
  await page.goto("/admin/review/statistics");
  await page.getByRole("button", { name: "숨기기" }).first().click();
  await expectToast(page, "통계량을 숨겼습니다.");
  await page.getByRole("button", { name: "복구" }).first().click();
  await expectToast(page, "통계량을 복구했습니다.");
});

test("account lookup finds an exact email", async ({ page }) => {
  await page.goto("/admin/users/lookup");
  await page.getByLabel("이메일").fill(ACCOUNTS.student);
  await page.getByRole("button", { name: "찾기" }).click();
  await expect(page.getByText(ACCOUNTS.student)).toBeVisible();
});

test("user summary and ops pages render", async ({ page }) => {
  for (const [path, heading] of [
    ["/admin/users/summary", "학과별 사용자 수"],
    ["/admin/ops/dashboard", "처리 대기"],
    ["/admin/ops/catalog", "강의 카탈로그"],
    ["/admin/ops/jobs", "예약 작업"],
    ["/admin/logs/archive-runs", "Google Drive 보관 이력"],
    ["/admin/users/admins", "관리자"],
  ] as const) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 2, name: heading }).first(),
    ).toBeVisible();
  }
});

test("a sitting is created for a course found by search", async ({ page }) => {
  await page.goto("/admin/voting/sittings");
  await page.getByLabel("강의 찾기").fill("선형대수학");
  const option = page.getByRole("radio", { name: /선형대수학/ }).first();
  await expect(option).toBeVisible();
  await option.check();
  // The only kind and year fields on this page belong to the create form.
  await page
    .getByRole("combobox", { name: "시험", exact: true })
    .selectOption({ label: "기말" });
  await page.getByRole("spinbutton", { name: "연도" }).fill("2025");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await expectToast(page, "회차를 만들었습니다.");
});

test("the course picker works without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await signIn(page, ACCOUNTS.admin);
  await page.goto("/admin/voting/sittings");
  await page.getByLabel("강의 찾기").fill("선형대수학");
  await page.getByRole("button", { name: "찾기" }).click();
  await expect(page).toHaveURL(/courseQ=/);
  await expect(
    page.getByRole("radio", { name: /선형대수학/ }).first(),
  ).toBeVisible();
  await context.close();
});

test("a statistic moves to a course found by search", async ({ page }) => {
  await page.goto("/admin/review/statistics");
  const card = page.locator("article").first();
  await card.getByText("다른 강의·시험으로 옮기기").click();
  await card.getByLabel("강의 찾기").fill("선형대수학");
  const option = card.getByRole("radio", { name: /선형대수학/ }).first();
  await expect(option).toBeVisible();
  await option.check();
  await card.getByRole("button", { name: "옮기기" }).click();
  await expectToast(page, "통계량을 옮겼습니다.");
});
