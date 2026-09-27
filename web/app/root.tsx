import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  redirect,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { apiContext, ApiSession } from "./api/client.server";
import "./app.css";
import { GlobalNav } from "./components/GlobalNav";
import { ProfileBanner } from "./components/ProfileBanner";
import { SignIn } from "./components/SignIn";
import { Toast } from "./components/Toast";
import { bannerDismissedCookie, readCookie } from "./lib/cookies.server";
import { env } from "./lib/env.server";
import { Flash, flashContext } from "./lib/flash.server";
import { getConfig, getMe } from "./lib/viewer.server";
import { pageUrl } from "./lib/url.server";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    // Actions change data with the viewer's API cookies, so refuse requests
    // a browser sent from another site.
    const origin = request.headers.get("Origin");
    if (UNSAFE.has(request.method) && origin && origin !== env.appOrigin) {
      throw data(null, { status: 403 });
    }

    const api = new ApiSession(request);
    const flash = await Flash.from(request);
    context.set(apiContext, api);
    context.set(flashContext, flash);

    const response = await next();
    for (const cookie of api.setCookies) {
      response.headers.append("Set-Cookie", cookie);
    }
    const flashCookie = await flash.commit();
    if (flashCookie) response.headers.append("Set-Cookie", flashCookie);
    return response;
  },
];

const AUTH_MESSAGES = {
  ok: { message: "로그인되었습니다.", kind: "info" },
  forbidden: { message: "snu.ac.kr 계정만 사용할 수 있습니다.", kind: "error" },
  error: { message: "Google 로그인을 완료하지 못했습니다.", kind: "error" },
} as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  // The OAuth callback lands on /?auth=…; turn it into a toast and drop the
  // parameter from the address.
  const url = pageUrl(request);
  const auth = url.searchParams.get("auth");
  if (auth && auth in AUTH_MESSAGES) {
    const { message, kind } = AUTH_MESSAGES[auth as keyof typeof AUTH_MESSAGES];
    context.get(flashContext).put(message, kind);
    url.searchParams.delete("auth");
    throw redirect(url.pathname + url.search);
  }

  const [me, config, dismissedFor] = await Promise.all([
    getMe(context),
    getConfig(context),
    readCookie<string>(bannerDismissedCookie, request),
  ]);
  const showProfileBanner =
    me !== null &&
    !me.college &&
    !me.admissionYear &&
    dismissedFor !== me.email;
  return {
    me,
    config,
    showProfileBanner,
    toast: context.get(flashContext).take(),
    devLogin: env.devLogin,
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "SNU Archive" }];
}

// Rendered by both the app and the error boundary, so error pages keep the
// navigation.
export function Layout({ children }: { children: React.ReactNode }) {
  const root = useRouteLoaderData<typeof loader>("root");
  return (
    // The inline script marks the page as JS-capable before first paint, so
    // CSS can hide no-JS fallbacks (e.g. "보기" buttons); React must not undo
    // the class it adds.
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js')",
          }}
        />
        <Meta />
        <Links />
      </head>
      <body>
        <GlobalNav me={root?.me ?? null} />
        {root?.showProfileBanner && (
          <ProfileBanner
            colleges={root.config.colleges}
            suggestedAdmissionYear={root.me?.suggestedAdmissionYear}
          />
        )}
        <main>{children}</main>
        <Toast toast={root?.toast ?? null} />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  if (!loaderData.me) return <SignIn devLogin={loaderData.devLogin} />;
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const root = useRouteLoaderData<typeof loader>("root");

  if (isRouteErrorResponse(error) && error.status === 401) {
    return <SignIn devLogin={root?.devLogin ?? false} />;
  }

  let message = "오류";
  let details = "알 수 없는 오류가 발생했습니다.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      message = "404";
      details = "페이지를 찾을 수 없습니다.";
    } else if (error.status === 403) {
      message = "403";
      details = "이 페이지를 볼 권한이 없습니다.";
    } else {
      details = error.statusText || details;
    }
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <section>
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre>
          <code>{stack}</code>
        </pre>
      )}
    </section>
  );
}
