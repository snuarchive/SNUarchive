import { Form, Outlet, useLocation } from "react-router";

import type { Route } from "./+types/layout";

export function loader({ request }: Route.LoaderArgs) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return { q };
}

export default function ArchiveLayout({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();

  return (
    <section>
      <aside aria-label="강의 검색">
        {/* GET to the current path, so searching keeps the open course. */}
        <Form method="get" action={pathname} role="search">
          <label htmlFor="searchInput">강의 검색</label>
          <input
            id="searchInput"
            name="q"
            type="search"
            autoComplete="off"
            placeholder="강의명, 교수명, 학과"
            defaultValue={loaderData.q}
            key={loaderData.q}
          />
        </Form>
        <div aria-label="검색 결과" />
      </aside>
      <section aria-live="polite">
        <Outlet />
      </section>
    </section>
  );
}
