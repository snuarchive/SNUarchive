import { Link, useLocation } from "react-router";

import { cx } from "~/lib/cx";
import ui from "~/styles/ui.module.css";

type Props = {
  cursor: string | null;
  loading: boolean;
  loadMore: () => void;
};

/**
 * The legacy "더 보기" button. With JavaScript it appends the next page;
 * without, it opens the page at ?cursor= on its own.
 */
export function MoreLink({ cursor, loading, loadMore }: Props) {
  const location = useLocation();
  if (!cursor) return null;
  const params = new URLSearchParams(location.search);
  params.set("cursor", cursor);

  return (
    <Link
      className={cx(ui.button, ui.subtle, ui.more)}
      to={`?${params}`}
      preventScrollReset
      onClick={(event) => {
        event.preventDefault();
        loadMore();
      }}
    >
      {loading ? "불러오는 중…" : "더 보기"}
    </Link>
  );
}

/** Where a list route's loader fetches its next page: the same address. */
export function pageEndpoint(pathname: string, search: string) {
  return (cursor: string) => {
    const params = new URLSearchParams(search);
    params.set("cursor", cursor);
    return `${pathname}?${params}`;
  };
}
