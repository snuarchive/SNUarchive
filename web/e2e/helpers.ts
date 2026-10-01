import { execSync } from "node:child_process";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { MOCK_ORIGIN, RESET_CMD, TARGET } from "./origins";

export const ACCOUNTS = {
  admin: "admin@snu.ac.kr",
  student: "student@snu.ac.kr",
  newbie: "newbie@snu.ac.kr",
} as const;

/**
 * Back to the seed state; every spec starts from here. The mock resets over
 * HTTP; a real backend through E2E_RESET_CMD (see origins.ts).
 */
export async function resetData(request: APIRequestContext) {
  if (TARGET === "mock") {
    const response = await request.post(`${MOCK_ORIGIN}/__mock/reset`);
    expect(response.ok()).toBe(true);
    return;
  }
  if (!RESET_CMD) {
    throw new Error(`E2E_RESET_CMD must be set when E2E_TARGET=${TARGET}`);
  }
  execSync(RESET_CMD, { stdio: "inherit" });
}

/** Makes the next matching API request fail once. Mock only. */
export async function injectFault(
  request: APIRequestContext,
  fault: { method: string; path: string; status: number; code: string },
) {
  test.skip(TARGET !== "mock", "needs the mock's fault injection");
  const response = await request.post(`${MOCK_ORIGIN}/__mock/faults`, {
    data: fault,
  });
  expect(response.ok()).toBe(true);
}

/** Signs in through the dev-login form on the sign-in screen. */
export async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByPlaceholder("student@snu.ac.kr").fill(email);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}

export async function expectToast(page: Page, text: string) {
  await expect(page.getByRole("status")).toContainText(text);
}

/** Opens a course by searching for its exact title. */
export async function openCourse(page: Page, title: string) {
  await page.getByRole("searchbox").fill(title);
  await page.getByRole("searchbox").press("Enter");
  const result = page
    .getByRole("link", { name: new RegExp(`^${title}`) })
    .first();
  await result.click();
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
}
