import { createCookie } from "react-router";

import { env } from "./env.server";

const secure = env.appOrigin.startsWith("https://");

/** The course opened last, so a fresh visit to / reopens it. */
export const lastCourseCookie = createCookie("web_last_course", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure,
  maxAge: 60 * 60 * 24 * 30,
});

/**
 * "나중에" on the profile banner. A browser-session cookie, like the legacy
 * sessionStorage flag, so the server can skip rendering the banner.
 */
export const bannerDismissedCookie = createCookie("web_profile_banner", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure,
});

export async function readCookie<T>(
  cookie: ReturnType<typeof createCookie>,
  request: Request,
): Promise<T | null> {
  return ((await cookie.parse(request.headers.get("Cookie"))) as T) ?? null;
}
