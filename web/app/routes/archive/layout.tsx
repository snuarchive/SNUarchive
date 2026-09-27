import { useEffect, useRef } from "react";
import {
  Form,
  Link,
  Outlet,
  useLocation,
  useParams,
  useSubmit,
} from "react-router";

import { apiContext, load } from "~/api/client.server";
import { CourseItem } from "~/components/CourseItem";
import { SearchResults } from "~/components/SearchResults";
import { cx } from "~/lib/cx";
import { SEARCH_PAGE_SIZE as PAGE_SIZE } from "~/lib/search";
import { requireMe } from "~/lib/viewer.server";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/layout";
import s from "./layout.module.css";
import { pageUrl } from "~/lib/url.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireMe(context);
  const url = pageUrl(request);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const client = context.get(apiContext).client;

  const favoriteIds = load(client.GET("/me/favorites/ids")).then((r) => r.ids);
  if (q) {
    const [page, ids] = await Promise.all([
      load(
        client.GET("/courses", {
          params: { query: { q, cursor, limit: PAGE_SIZE } },
        }),
      ),
      favoriteIds,
    ]);
    return { q, cursor: cursor ?? null, page, home: null, favoriteIds: ids };
  }
  const [home, ids] = await Promise.all([
    load(client.GET("/courses/home")),
    favoriteIds,
  ]);
  return { q, cursor: null, page: null, home, favoriteIds: ids };
}

const SEARCH_DELAY_MS = 250;

export default function ArchiveLayout({ loaderData }: Route.ComponentProps) {
  const { q, cursor, page, home, favoriteIds } = loaderData;
  const { pathname, key: locationKey } = useLocation();
  const { courseId } = useParams();
  const activeId = courseId ? Number(courseId) : null;
  const favorites = new Set(favoriteIds);
  const hasSelection = activeId !== null;

  // Legacy search filtered as you typed. With JavaScript, submit the GET form
  // shortly after typing stops; without it, Enter submits.
  const submit = useSubmit();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A pending search must not fire after the user moved on (opened a course,
  // pressed Enter): cancel it whenever the address changes.
  useEffect(() => () => clearTimeout(timer.current), [locationKey]);

  // Keep the box in step with the address (back button, the Archive link)
  // without fighting the user while they type.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const node = input.current;
    if (node && document.activeElement !== node) node.value = q;
  }, [q]);
  const onInput = (event: React.FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => submit(form, { replace: true, preventScrollReset: true }),
      SEARCH_DELAY_MS,
    );
  };

  const homeSections = home
    ? ([
        ["즐겨찾기", home.favorites],
        ["투표 진행중", home.votingOpen],
        ["최근 제보", home.recentlyUpdated],
        ["요청 많은 강의", home.mostRequested],
      ] as const)
    : [];
  const homeEmpty = homeSections.every(([, items]) => items.length === 0);

  return (
    <section className={cx(s.view, hasSelection && s.hasSelection)}>
      {/* On narrow screens the pane folds; it starts folded while a course
          is open, as the legacy view did after picking one. */}
      <details
        className={cx(ui.panel, s.pane)}
        open={!hasSelection}
        aria-label="강의 검색"
      >
        <summary className={s.head}>
          <span className={s.headLabel}>강의 검색</span>
          <span
            className={cx(ui.button, ui.iconButton, s.toggle)}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </summary>
        <div className={s.content}>
          {/* GET to the current path, so searching keeps the open course. */}
          <Form
            method="get"
            action={pathname}
            role="search"
            onInput={onInput}
            onSubmit={() => clearTimeout(timer.current)}
          >
            <label htmlFor="searchInput" className="sr-only">
              강의 검색
            </label>
            <input
              ref={input}
              id="searchInput"
              className={s.input}
              name="q"
              type="search"
              autoComplete="off"
              placeholder="강의명, 교수명, 학과"
              defaultValue={q}
              maxLength={100}
            />
          </Form>
          <div className={s.results} aria-label="검색 결과">
            {page ? (
              <SearchResults
                key={`${q}|${cursor ?? ""}`}
                q={q}
                initial={page}
                favorites={favorites}
                activeId={activeId}
              />
            ) : homeEmpty ? (
              <div className={ui.emptySmall}>
                검색어를 입력하거나 즐겨찾기를 추가하세요.
              </div>
            ) : (
              homeSections.map(([title, items]) =>
                items.length === 0 ? null : (
                  <section
                    key={title}
                    className={s.homeSection}
                    aria-label={title}
                  >
                    <div className={s.homeHead}>
                      <h3>{title}</h3>
                      {title === "즐겨찾기" && (
                        <Link to="/me#favorites">모두 보기 · 순서 바꾸기</Link>
                      )}
                    </div>
                    {items.map((course) => (
                      <CourseItem
                        key={course.id}
                        course={course}
                        favorite={favorites.has(course.id)}
                        active={course.id === activeId}
                        q=""
                        extraBadge={
                          "openRequestCount" in course
                            ? `요청 ${course.openRequestCount}건`
                            : undefined
                        }
                      />
                    ))}
                  </section>
                ),
              )
            )}
          </div>
        </div>
      </details>
      <section className={s.detail} aria-live="polite">
        <Outlet />
      </section>
    </section>
  );
}
