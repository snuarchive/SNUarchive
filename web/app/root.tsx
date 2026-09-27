import {
  isRouteErrorResponse,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export function meta(): Route.MetaDescriptors {
  return [{ title: "SNU Archive" }];
}

// Rendered by both the app and the error boundary, so error pages keep the
// navigation.
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <header>
          <div>
            <strong>SNU Archive</strong>
          </div>
          {/* TODO(api): show only to admins, as the legacy view tabs did. */}
          <nav aria-label="보기 전환">
            <NavLink to="/" end>
              Archive
            </NavLink>
            <NavLink to="/admin">Admin</NavLink>
          </nav>
          <div />
        </header>
        <main>{children}</main>
        <div role="status" aria-live="polite" />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "오류";
  let details = "알 수 없는 오류가 발생했습니다.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "오류";
    details =
      error.status === 404
        ? "페이지를 찾을 수 없습니다."
        : error.statusText || details;
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
