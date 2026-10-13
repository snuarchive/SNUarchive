import { expect, test } from "@playwright/test";

import {
  ACCOUNTS,
  expectToast,
  openCourse,
  resetData,
  signIn,
} from "./helpers";

// Behaviours carried over from the legacy public/app.js (see the "보존할 동작"
// table in docs/findings/non-backend.md on the docs/legacy-findings branch).

const COURSE = "미적분학 1";

test.beforeEach(async ({ request }) => {
  await resetData(request);
});

test("a direct-report draft survives a reload and reopens the card", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.student);
  await openCourse(page, COURSE);
  await page.getByText("직접 제보").click();
  const card = page.locator("details", { hasText: "직접 제보" });
  await card.getByLabel("Q3").fill("77");
  await card.getByLabel("비고").fill("임시저장 확인");

  await page.reload();
  await expect(card).toHaveAttribute("open", "");
  await expect(card.getByLabel("Q3")).toHaveValue("77");
  await expect(card.getByLabel("비고")).toHaveValue("임시저장 확인");
});

test("the last nickname is remembered for the next report", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.student);
  await openCourse(page, COURSE);
  await page.getByText("직접 제보").click();
  const card = page.locator("details", { hasText: "직접 제보" });
  await card.getByLabel("닉네임").fill("기억해줘");
  await card.getByLabel("Q2").fill("50");
  await card.getByRole("button", { name: "등록" }).click();
  await expectToast(page, "통계량을 등록했습니다.");

  await page.reload();
  await page.getByText("간편 제보").click();
  const quick = page.locator("details", { hasText: "간편 제보" });
  await expect(quick.getByLabel("닉네임")).toHaveValue("기억해줘");
});

test("number fields refuse e, E, + and -", async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await openCourse(page, COURSE);
  await page.getByText("직접 제보").click();
  const q1 = page.locator("details", { hasText: "직접 제보" }).getByLabel("Q1");
  await q1.pressSequentially("1e2-3+");
  await expect(q1).toHaveValue("123");
});

test("the submit button stays off until something is entered", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.student);
  await openCourse(page, COURSE);
  await page.getByText("직접 제보").click();
  const card = page.locator("details", { hasText: "직접 제보" });
  await expect(card.getByRole("button", { name: "등록" })).toBeDisabled();
  await card.getByLabel("평균").fill("61");
  await expect(card.getByRole("button", { name: "등록" })).toBeEnabled();
});

test("on narrow screens the search pane folds once a course is open", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await signIn(page, ACCOUNTS.student);
  const pane = page.locator("details[aria-label='강의 검색']");
  await expect(pane).toHaveAttribute("open", "");
  await openCourse(page, COURSE);
  await expect(pane).not.toHaveAttribute("open", "");
  await expect(page.getByRole("searchbox")).toBeHidden();
  await pane.locator("summary").click();
  await expect(page.getByRole("searchbox")).toBeVisible();
  await context.close();
});

test("on wide screens the search pane never folds", async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  await openCourse(page, COURSE);
  await expect(page.getByRole("searchbox")).toBeVisible();
});

test("admins see the course's pending uploads on the course page", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.admin);
  await openCourse(page, COURSE);
  await expect(
    page.getByRole("heading", { name: "이 과목 제보 큐" }),
  ).toBeVisible();
});

test("result badges show favourite, voting and the latest report date", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.student);
  const favourites = page.getByRole("region", { name: "즐겨찾기" });
  const first = favourites.locator("article").first();
  await expect(first.locator("em", { hasText: "즐겨찾기" })).toBeVisible();
  const voting = page.getByRole("region", { name: "투표 진행중" });
  await expect(
    voting.locator("em", { hasText: "투표중" }).first(),
  ).toBeVisible();
});
