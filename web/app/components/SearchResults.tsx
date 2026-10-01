import { useEffect, useRef } from "react";
import { Link } from "react-router";

import type { Schemas } from "~/api/types";
import { usePagedList } from "~/lib/usePagedList";
import ui from "~/styles/ui.module.css";
import { CourseItem } from "./CourseItem";
import s from "./SearchResults.module.css";

type Props = {
  q: string;
  initial: Schemas["CourseSummaryPage"];
  favorites: Set<number>;
  activeId: number | null;
};

/**
 * Search results with infinite scroll: later pages come from /search through
 * a fetcher and are appended here. Without JavaScript the sentinel is a plain
 * "더 보기" link to the next page.
 */
export function SearchResults({ q, initial, favorites, activeId }: Props) {
  const query = encodeURIComponent(q);
  const { items, cursor, loading, loadMore } = usePagedList(
    initial,
    (c) => `/search?q=${query}&cursor=${encodeURIComponent(c)}`,
  );
  const sentinel = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      // Start loading a little before the end, like the legacy 180px margin.
      { rootMargin: "0px 0px 180px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  });

  if (items.length === 0) {
    return <div className={ui.emptySmall}>검색 결과가 없습니다.</div>;
  }

  return (
    <>
      {items.map((course) => (
        <CourseItem
          key={course.id}
          course={course}
          favorite={favorites.has(course.id)}
          active={course.id === activeId}
          q={q}
        />
      ))}
      {cursor && (
        <Link
          ref={sentinel}
          className={s.more}
          to={`?q=${query}&cursor=${encodeURIComponent(cursor)}`}
          onClick={(event) => {
            event.preventDefault();
            loadMore();
          }}
        >
          {loading ? "불러오는 중…" : "더 보기"}
        </Link>
      )}
    </>
  );
}
