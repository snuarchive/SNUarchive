import { expect, test } from "@playwright/test";

import {
  ACCOUNTS,
  expectToast,
  openCourse,
  resetData,
  signIn,
} from "./helpers";

// 미적분학 1 has a sitting open for voting in the seed data.
const OPEN_COURSE = "미적분학 1";

test.beforeEach(async ({ request, page }) => {
  await resetData(request);
  await signIn(page, ACCOUNTS.student);
});

test("sign-in lands on the home lists with a toast", async ({ page }) => {
  await expectToast(page, "로그인되었습니다.");
  const pane = page
    .getByRole("group", { name: "강의 검색" })
    .or(page.locator("details"));
  await expect(pane.getByRole("heading", { name: "즐겨찾기" })).toBeVisible();
  await expect(
    pane.getByRole("heading", { name: "투표 진행중" }),
  ).toBeVisible();
});

test("searching as you type puts the query in the address", async ({
  page,
}) => {
  await page.getByRole("searchbox").pressSequentially("미적분");
  await expect(page).toHaveURL(/\?q=%EB%AF%B8%EC%A0%81%EB%B6%84/);
  await expect(
    page.getByRole("link", { name: /미적분학/ }).first(),
  ).toBeVisible();
});

test("a course with open voting shows voting first and takes a vote", async ({
  page,
}) => {
  await openCourse(page, OPEN_COURSE);
  const sections = page.locator(
    "article > section[aria-labelledby], article > section[aria-label]",
  );
  await expect(sections.first()).toHaveAttribute(
    "aria-labelledby",
    "poll-heading",
  );
  await expect(page.getByText(/난이도 투표 진행중/)).toBeVisible();

  await page.locator("label", { hasText: "보통" }).click();
  await page.getByRole("button", { name: /^(다시 )?투표$/ }).click();
  await expectToast(page, "투표했습니다.");
});

test("a statistic is refused with field errors, then accepted", async ({
  page,
}) => {
  await openCourse(page, OPEN_COURSE);
  await page.getByText("직접 제보").click();
  const form = page.locator("details", { hasText: "직접 제보" });

  await form.getByLabel("Q1").fill("60");
  await form.getByLabel("Q2").fill("40");
  await form.getByRole("button", { name: "등록" }).click();
  await expect(
    form.getByText("Q1 ≤ Q2 ≤ Q3 ≤ Q4 순서여야 합니다.").first(),
  ).toBeVisible();

  await form.getByLabel("Q2").fill("70");
  await form.getByRole("button", { name: "등록" }).click();
  await expectToast(page, "통계량을 등록했습니다.");
  await expect(form.getByLabel("Q1")).toHaveValue("");
});

test("comments count code points and post", async ({ page }) => {
  await openCourse(page, OPEN_COURSE);
  const box = page.getByRole("textbox", { name: "한줄 후기" });
  await expect(
    page.getByRole("button", { name: "등록" }).last(),
  ).toBeDisabled();
  await box.fill("좋아요👍");
  await expect(page.getByText("4/50")).toBeVisible();
  await page.getByRole("button", { name: "등록" }).last().click();
  await expectToast(page, "후기를 등록했습니다.");
  await expect(page.getByText("좋아요👍")).toBeVisible();
});

test("uploads go to the review queue", async ({ page }) => {
  await openCourse(page, OPEN_COURSE);
  await page.getByText("간편 제보").click();
  const form = page.locator("details", { hasText: "간편 제보" });
  // A one-pixel PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
    "base64",
  );
  await form
    .getByLabel("파일")
    .setInputFiles({ name: "slide.png", mimeType: "image/png", buffer: png });
  await form.getByRole("button", { name: "업로드" }).click();
  await expectToast(page, "간편 제보를 접수했습니다.");
});

test("voting can be requested for a sitting that is not open", async ({
  page,
}) => {
  await page.getByRole("searchbox").fill("선형대수학");
  await page.getByRole("searchbox").press("Enter");
  await page
    .getByRole("link", { name: /^선형대수학/ })
    .first()
    .click();
  await page.getByRole("button", { name: "투표 요청" }).click();
  await expectToast(page, "투표를 요청했습니다.");
  await page.getByRole("button", { name: "요청 취소" }).click();
  await expectToast(page, "투표 요청을 취소했습니다.");
});

test("a fresh visit reopens the last course; the Archive link does not", async ({
  page,
  context,
}) => {
  await openCourse(page, OPEN_COURSE);
  const courseUrl = page.url().split("?")[0];

  await page.goto("/");
  await expect(page).toHaveURL(courseUrl);

  // Admins see the Archive link; students reach /archive the same way.
  await page.goto("/archive");
  await expect(page).toHaveURL("/");
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "web_last_course")).toBeUndefined();
});

test("favourites toggle from the course header", async ({ page }) => {
  await openCourse(page, OPEN_COURSE);
  const star = page.getByRole("button", { name: /[★☆]/ }).first();
  const wasOn = (await star.getAttribute("aria-pressed")) === "true";
  await star.click();
  await expectToast(
    page,
    wasOn ? "즐겨찾기에서 제거했습니다." : "즐겨찾기에 추가했습니다.",
  );
});

test("search and sign-in work without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await signIn(page, ACCOUNTS.student);
  await page.getByRole("searchbox").fill("미적분학");
  await page.getByRole("searchbox").press("Enter");
  await expect(page).toHaveURL(/\?q=/);
  await expect(
    page.getByRole("link", { name: /미적분학/ }).first(),
  ).toBeVisible();
  await context.close();
});

test("field errors describe their input without renaming it", async ({
  page,
}) => {
  await openCourse(page, OPEN_COURSE);
  await page.getByText("직접 제보").click();
  const form = page.locator("details", { hasText: "직접 제보" });
  // A figure above the full mark is an error on that field (the contract
  // reports quartile order on the whole form instead).
  await form.getByRole("spinbutton", { name: "Q2", exact: true }).fill("120");
  await form.getByRole("spinbutton", { name: "만점", exact: true }).fill("100");
  await form.getByRole("button", { name: "등록" }).click();
  const q2 = form.getByRole("spinbutton", { name: "Q2", exact: true });
  await expect(q2).toHaveAttribute("aria-invalid", "true");
  await expect(q2).toHaveAccessibleDescription(/만점보다 클 수 없습니다/);
});

test("pasted numbers are cleaned like typed ones", async ({ page }) => {
  await openCourse(page, OPEN_COURSE);
  await page.getByText("직접 제보").click();
  const q1 = page
    .locator("details", { hasText: "직접 제보" })
    .getByRole("spinbutton", { name: "Q1", exact: true });
  await q1.focus();
  await q1.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text", "-1e2");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(q1).toHaveValue("12");
});
